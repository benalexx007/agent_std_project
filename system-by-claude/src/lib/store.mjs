// TaskStore: trang thai dieu phoi tren dia. Journal (events.jsonl) la nguon su that; state.json = fold(journal) (cache).
//
// QUY TAC SO HUU (r2, B4): CHI tien trinh dang giu lease cua task (runner) duoc append journal, qua Journal (seq trong bo nho).
// Moi ben khac (hub, MCP server, CLI) chi ghi task.json (1 lan, khi tao), control/ (yeu cau) va doc.
//
// Bo cuc:
//   <root>/tasks/<id>/task.json          spec bat bien (hub ghi 1 lan)
//   <root>/tasks/<id>/events.jsonl       journal append-only (1 writer: runner giu lease)
//   <root>/tasks/<id>/state.json         snapshot (cache)
//   <root>/tasks/<id>/control/           cancel.request, resume.request, followup-*.json  (hub -> runner)
//   <root>/tasks/<id>/attempts/<n>/      invocation.json, raw.jsonl, stderr.log
//   <root>/tasks/<id>/artifacts/         final-message.md, ...
//   <root>/tasks/<id>/result.json        ResultEnvelope cua turn gan nhat (co truong turn)
//   <root>/idem/<sha>.json               idempotency_key -> task_id
//   <root>/notifications/<ts>-<id>-<r>.json  thong bao BAT BIEN (B6); khong ai xoa khi doc
//   <root>/cursors/<consumer>.json       vi tri da doc cua tung nguoi tieu thu: {last, seen[] trong LOOKBACK_MS} (r3 N2)
// r3:
//   <root>/tasks/<id>/control/followup-<fid>.json  followup co id (N10); xoa SAU khi journal co followup.accepted{ids}
//   <root>/tasks/<id>/control/dropped/             followup bi cancel bo (N1) - giu dau vet, khong xoa
//   <root>/tasks/<id>/control/launch-<ts>-<r>.json hub ghi moi lan launch runner (N3); runner-main xoa khi khoi dong
//   <root>/tasks/<id>/runner.started.json          runner-main ghi NGAY khi khoi dong (N3)
//   <root>/tasks/<id>/runner.fatal.json            runner chet truoc/khi chay vong lap (N3) -> hub tra runner_failed
//   <root>/bin/jobrun-<hash12>.exe                 trinh boc Job Object KILL_ON_JOB_CLOSE (N5), bien dich bang Add-Type
//   state.json co journal_bytes: chi dung khi khop kich thuoc events.jsonl (N10); idem bam theo cwd+key (N6)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ensureDir, writeJsonAtomic, readJson, exists, appendJsonLine, readJsonLines,
} from './fsutil.mjs';
import { newId } from './ids.mjs';

// needs_input la ket thuc cua LUOT nay (agent can them thong tin); orchestrator tiep tuc bang followup.
export const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'needs_input']);

/**
 * Mac dinh theo NGUOI DUNG (B23): moi GUI/phien cung thay mot store, khong lam ban git status cua repo.
 * N11 (r3): GUI co the chay MCP server voi env rut gon (thieu LOCALAPPDATA) -> Windows roi ve %USERPROFILE%\AppData\Local
 * (cung thu muc LOCALAPPDATA tro toi tren cau hinh mac dinh), KHONG roi ve ~/.local/state (store thu hai, tach doi task).
 */
export function defaultRoot(env = process.env, platform = process.platform) {
  if (env.ORCH_HOME) return env.ORCH_HOME;
  const base = platform === 'win32'
    ? (env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? os.homedir(), 'AppData', 'Local'))
    : (env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'));
  return path.join(base, 'subagent-hub', 'default');
}

/** Chuan hoa cwd de so sanh/bam (N6): tuyet doi, Windows khong phan biet hoa thuong, bo dau phan cach cuoi. */
// r3.1 (M6): giai ten 8.3 va junction/symlink bang realpathSync.native (khi duong dan ton tai) -> cung mot thu muc viet
// theo 3 dang (dai / USERNA~1 / junction) cho CUNG mot khoa idem, tran theo cwd va bo loc inbox. Cache nho theo chuoi vao.
const _realCache = new Map();
function realOrResolve(p) {
  const abs = path.resolve(String(p));
  if (_realCache.has(abs)) return _realCache.get(abs);
  let r = abs;
  try { r = fs.realpathSync.native(abs); } catch {
    // khong ton tai (vd cwd con cua task da xoa) -> giai to tien GAN NHAT con ton tai roi noi phan con lai: cung dang voi
    // path ton tai (USERNA~1 vs 'Firstname Lastname'); khong cache vi path co the duoc tao sau.
    let head = abs; const rest = [];
    while (path.dirname(head) !== head) {
      rest.unshift(path.basename(head)); head = path.dirname(head);
      try { return path.join(fs.realpathSync.native(head), ...rest); } catch {}
    }
    return abs;
  }
  if (_realCache.size > 500) _realCache.clear();
  _realCache.set(abs, r);
  return r;
}
export function normCwd(p) {
  if (!p) return '';
  let r = realOrResolve(p);
  if (process.platform === 'win32') r = r.toLowerCase();
  return r.length > 3 ? r.replace(/[\\/]+$/, '') : r;
}
/** a nam trong (hoac bang) b? */
export function cwdWithin(a, b) {
  const x = normCwd(a); const y = normCwd(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y.endsWith(path.sep) ? y : y + path.sep);
}

const LOOKBACK_MS = 30_000; // N2: cua so nhin lai cho thong bao rename xong muon hon ten (timestamp luc tao)
const tsOf = (name) => parseInt(name.slice(0, 15), 10) || 0;

export class TaskStore {
  constructor(root = defaultRoot()) {
    this.root = path.resolve(root);
    for (const d of ['tasks', 'idem', 'notifications', 'cursors']) ensureDir(path.join(this.root, d));
  }

  taskDir(id) { return path.join(this.root, 'tasks', id); }
  file(id, name) { return path.join(this.taskDir(id), name); }
  controlDir(id) { return path.join(this.taskDir(id), 'control'); }

  /**
   * Tao task (chi ghi task.json - KHONG ghi journal; runner ghi task.created khi journal rong).
   * Trung idempotency_key -> tra task cu.
   * @returns {{task: object, created: boolean}}
   */
  createTask(spec) {
    const key = spec.idempotency_key;
    let idemFile;
    if (key) {
      // N6: store dung chung theo nguoi dung -> khoa idem gom ca cwd (hai project cung key khong dung nhau)
      idemFile = path.join(this.root, 'idem', crypto.createHash('sha256').update(normCwd(spec.cwd) + '\0' + key).digest('hex').slice(0, 32) + '.json');
      const prev = readJson(idemFile, null);
      if (prev && exists(this.taskDir(prev.task_id))) return { task: this.getTask(prev.task_id), created: false };
    }
    const id = spec.task_id || newId('t');
    const dir = this.taskDir(id);
    for (const d of ['control', 'attempts', 'artifacts']) ensureDir(path.join(dir, d));
    const task = { ...spec, task_id: id, created_at: new Date().toISOString() };
    writeJsonAtomic(this.file(id, 'task.json'), task);
    if (idemFile) {
      try {
        fs.writeFileSync(idemFile, JSON.stringify({ task_id: id }), { flag: 'wx' });
      } catch (e) {
        if (e.code === 'EEXIST') {
          fs.rmSync(dir, { recursive: true, force: true });
          const prev = readJson(idemFile);
          return { task: this.getTask(prev.task_id), created: false };
        }
        throw e;
      }
    }
    return { task, created: true };
  }

  getTask(id) { return readJson(this.file(id, 'task.json')); }
  hasTask(id) { return exists(this.file(id, 'task.json')); }

  listTaskIds() {
    try { return fs.readdirSync(path.join(this.root, 'tasks')).sort(); } catch { return []; }
  }

  // ---------- journal (doc) ----------
  events(id, sinceSeq = 0) {
    return readJsonLines(this.file(id, 'events.jsonl')).filter((e) => e.seq > sinceSeq);
  }

  /** Doc trang thai. Uu tien fold(journal) khi snapshot cu hon journal (snapshot chi la cache). */
  state(id) {
    // N10: snapshot chi dung khi khop KICH THUOC journal luc ghi (runner co the chet giua append va ghi snapshot).
    const s = readJson(this.file(id, 'state.json'), null);
    let size = 0;
    try { size = fs.statSync(this.file(id, 'events.jsonl')).size; } catch {}
    if (s && s.journal_bytes === size) return s;
    return foldEvents(this.getTask(id), this.events(id));
  }

  rebuildState(id) { return foldEvents(this.getTask(id), this.events(id)); }

  /** Mo writer cua journal. CHI goi khi dang giu lease cua task (runner). */
  openJournal(id) { return new Journal(this, id); }

  // ---------- control (kenh nguoc: hub -> runner) ----------
  request(id, kind, data = {}) {
    writeJsonAtomic(path.join(this.controlDir(id), `${kind}.request`), { ...data, at: new Date().toISOString() });
  }
  readRequest(id, kind) { return readJson(path.join(this.controlDir(id), `${kind}.request`), null); }
  clearRequest(id, kind) { try { fs.unlinkSync(path.join(this.controlDir(id), `${kind}.request`)); } catch {} }
  requestCancel(id, reason = 'user') { this.request(id, 'cancel', { reason }); }
  cancelRequested(id) { return this.readRequest(id, 'cancel'); }
  clearCancel(id) { this.clearRequest(id, 'cancel'); }

  /** @returns {string} followup_id (N10) - dung voi subagent_wait(until_followup) thay vi doan turn. */
  enqueueFollowup(id, prompt) {
    const fid = `f${Date.now().toString().padStart(15, '0')}-${crypto.randomBytes(3).toString('hex')}`;
    writeJsonAtomic(path.join(this.controlDir(id), `followup-${fid}.json`), { followup_id: fid, prompt, at: new Date().toISOString() });
    return fid;
  }
  _followupFiles(id) {
    try { return fs.readdirSync(this.controlDir(id)).filter((f) => f.startsWith('followup-') && f.endsWith('.json')).sort(); } catch { return []; }
  }
  pendingFollowups(id) { return this._followupFiles(id).length; }
  /** Doc (KHONG xoa) followup dang cho, cu truoc. Xoa bang ackFollowups SAU khi da ghi followup.accepted (N10). */
  peekFollowups(id) {
    const out = [];
    for (const f of this._followupFiles(id)) {
      const v = readJson(path.join(this.controlDir(id), f), null);
      if (v) out.push({ ...v, followup_id: v.followup_id ?? f.slice(9, -5), file: f });
    }
    return out;
  }
  ackFollowups(id, files) { for (const f of files) { try { fs.unlinkSync(path.join(this.controlDir(id), f)); } catch {} } }
  /** N1: chuyen followup sang control/dropped/ (khong xoa - con dau vet). */
  dropFollowups(id, files) {
    const dd = ensureDir(path.join(this.controlDir(id), 'dropped'));
    for (const f of files) { try { fs.renameSync(path.join(this.controlDir(id), f), path.join(dd, f)); } catch {} }
  }
  /** Tuong thich r2 (test cu): lay va xoa ngay. Runner r3 dung peek + accepted + ack. */
  takeFollowups(id) {
    const fs_ = this.peekFollowups(id);
    this.ackFollowups(id, fs_.map((f) => f.file));
    return fs_;
  }
  /** Con viec cho runner? (followup / cancel / resume) - runner kiem lai SAU khi nha lease de khong bo sot. */
  hasPendingControl(id) {
    try { return fs.readdirSync(this.controlDir(id)).some((f) => (f.startsWith('followup-') && f.endsWith('.json')) || f.endsWith('.request')); } catch { return false; }
  }

  // ---------- N3: theo doi khoi dong runner ----------
  /** Hub ghi moi lan launch (control/launch-<ts>.json); runner-main xoa khi da khoi dong. */
  recordLaunch(id, pid = null) {
    try { writeJsonAtomic(path.join(this.controlDir(id), `launch-${Date.now()}-${crypto.randomBytes(2).toString('hex')}.json`), { pid, at: Date.now() }); } catch {}
  }
  launches(id) {
    try { return fs.readdirSync(this.controlDir(id)).filter((f) => f.startsWith('launch-')).map((f) => parseInt(f.slice(7), 10)).filter(Number.isFinite).sort(); } catch { return []; }
  }
  /** runner-main goi NGAY khi khoi dong (truoc moi thu co the loi): ghi runner.started, xoa dau launch. */
  markRunnerStarted(id) {
    writeJsonAtomic(this.file(id, 'runner.started.json'), { pid: process.pid, at: Date.now() });
    for (const f of (() => { try { return fs.readdirSync(this.controlDir(id)); } catch { return []; } })()) {
      if (f.startsWith('launch-')) { try { fs.unlinkSync(path.join(this.controlDir(id), f)); } catch {} }
    }
  }
  runnerStarted(id) { return readJson(this.file(id, 'runner.started.json'), null); }
  writeRunnerFatal(id, message) { try { writeJsonAtomic(this.file(id, 'runner.fatal.json'), { message: String(message).slice(0, 4000), at: Date.now(), pid: process.pid }); } catch {} }
  runnerFatal(id) { return readJson(this.file(id, 'runner.fatal.json'), null); }
  clearRunnerFailure(id) {
    try { fs.unlinkSync(this.file(id, 'runner.fatal.json')); } catch {}
    try { for (const f of fs.readdirSync(this.controlDir(id))) if (f.startsWith('launch-')) fs.unlinkSync(path.join(this.controlDir(id), f)); } catch {}
  }
  logTail(id, n = 15) {
    try { return fs.readFileSync(this.file(id, 'runner.log'), 'utf8').split('\n').filter(Boolean).slice(-n).join('\n'); } catch { return ''; }
  }

  // ---------- attempt logs, result, artifact ----------
  attemptDir(id, n) { return ensureDir(path.join(this.taskDir(id), 'attempts', String(n))); }
  artifactsDir(id) { return ensureDir(path.join(this.taskDir(id), 'artifacts')); }
  writeResult(id, envelope) { writeJsonAtomic(this.file(id, 'result.json'), envelope); }
  readResult(id) { return readJson(this.file(id, 'result.json'), null); }

  // ---------- thong bao bat bien + cursor theo nguoi tieu thu (B6) ----------
  notify(id, payload) {
    const name = `${Date.now().toString().padStart(15, '0')}-${id}-${crypto.randomBytes(3).toString('hex')}.json`;
    writeJsonAtomic(path.join(this.root, 'notifications', name), { task_id: id, at: new Date().toISOString(), ...payload });
    return name;
  }

  /**
   * Doc thong bao chua doc cua `consumer` (khong xoa cua ai). Consumer moi chi thay thong bao trong `freshMs` gan nhat.
   * @returns {object[]}
   */
  //
  // r3 (N2) - bat bien "0 mat, 0 lap" cho MOT consumer:
  //  (1) tra CU NHAT truoc, toi da `max`; cursor chi tien toi phan tu cuoi DA XU LY (phan con lai giu cho lan sau);
  //  (2) ten thong bao mang timestamp LUC TAO nhung chi hien ra sau rename -> co the "chen" vao sau cursor. Cursor giu
  //      `seen` = cac ten da xu ly trong cua so LOOKBACK_MS truoc `last`; lan doc sau quet lai cua so do, bo qua ten da seen;
  //  (3) hai tien trinh cung consumer (2 hook song song - Codex chay hook dong thoi) -> khoa theo consumer bang named pipe
  //      `cursor-<consumer>` (OS tu nha khi chet); cho <= lockWaitMs roi bo qua (tra []) - hook khong bao gio treo.
  //  Thong bao bi filter loai (khac cwd) duoc tinh la DA XU LY cho consumer nay (consumer gan voi phien/cwd).
  async readNotifications(consumer = 'default', { advance = true, freshMs = 24 * 3600_000, max = 10, filter = null, lockWaitMs = 300 } = {}) {
    const safe = String(consumer).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || 'default';
    let lock = null;
    if (advance) {
      const { acquireLease } = await import('./lease.mjs');
      const t0 = Date.now();
      for (;;) {
        try { lock = await acquireLease(this.root, `cursor-${safe}`); } catch { return []; }
        if (lock || Date.now() - t0 >= lockWaitMs) break;
        await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 20)));
      }
      if (!lock) return [];
    }
    try {
      return this._readNotificationsLocked(safe, { advance, freshMs, max, filter });
    } finally {
      if (lock) await lock.release();
    }
  }

  _readNotificationsLocked(safe, { advance, freshMs, max, filter }) {
    const curFile = path.join(this.root, 'cursors', `${safe}.json`);
    const cur = readJson(curFile, null);
    const dir = path.join(this.root, 'notifications');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp')).sort(); } catch {}
    const seen = new Set(cur?.seen ?? []);
    const lastTs = cur ? tsOf(cur.last ?? '') : 0;
    const from = cur ? lastTs - LOOKBACK_MS : Date.now() - freshMs;
    const cand = files.filter((f) => tsOf(f) >= from && !seen.has(f));
    const items = [];
    const processed = [];
    for (const f of cand) {
      if (items.length >= max) break;
      const v = readJson(path.join(dir, f), null);
      if (!v) break; // khong doc duoc (AV/khoa) -> dung lai, lan sau doc tiep; khong nhay qua
      processed.push(f);
      if (!filter || filter(v)) items.push(v);
    }
    if (advance && processed.length) {
      const last = [cur?.last ?? '', ...processed].sort().pop();
      const keepFrom = tsOf(last) - LOOKBACK_MS;
      const newSeen = [...seen, ...processed].filter((f) => tsOf(f) >= keepFrom);
      writeJsonAtomic(curFile, { last, seen: newSeen, at: new Date().toISOString() });
    }
    return items;
  }
}

/**
 * Writer journal cua MOT runner (dang giu lease): seq va state giu trong bo nho -> O(1) moi lan ghi (B24),
 * khong doc lai file; khong the trung seq vi chi co mot writer (lease do OS giu).
 */
export class Journal {
  constructor(store, id) {
    this.store = store;
    this.id = id;
    this.file = store.file(id, 'events.jsonl');
    this.task = store.getTask(id);
    const evs = store.events(id);
    this.state = foldEvents(this.task, evs);
    this.events = evs; // giu de dem (interruptions...), task nho
    this._writeSnapshot(); // N10: snapshot cu (runner truoc chet giua append va ghi snapshot) duoc ghi lai ngay
  }
  _writeSnapshot() {
    try {
      this.state.journal_bytes = fs.statSync(this.file).size;
    } catch { this.state.journal_bytes = 0; }
    try { writeJsonAtomic(this.store.file(this.id, 'state.json'), this.state); } catch { /* cache - doc se fold lai */ }
  }
  get empty() { return this.events.length === 0; }
  append(type, data = {}, attempt = undefined) {
    const ev = { seq: this.state.last_seq + 1, ts: new Date().toISOString(), type, ...(attempt !== undefined ? { attempt } : {}), data };
    appendJsonLine(this.file, ev);
    this.events.push(ev);
    applyEvent(this.state, ev);
    this._writeSnapshot();
    return ev;
  }
  /** So lan bi gian doan trong turn hien tai (chong poison pill - B12). */
  interruptionsThisTurn() {
    let n = 0;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const t = this.events[i].type;
      if (t === 'followup.accepted' || t === 'task.created' || t === 'task.resumed') break;
      if (t === 'task.interrupted') n++;
    }
    return n;
  }
  lastOf(type) {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].type === type) return this.events[i];
    return null;
  }
  /** N4: attempt cuoi da ghi attempt.exited chua? (da thoat -> pid khong con la cua ta, KHONG kill) */
  lastAttemptExited() {
    const st = this.lastOf('attempt.started');
    if (!st) return true;
    return this.events.some((e) => e.type === 'attempt.exited' && e.attempt === st.attempt && e.seq > st.seq);
  }
  /** N10: followup_id da duoc ghi nhan (accepted) hoac bo (dropped) trong journal. */
  handledFollowupIds() {
    const s = new Set();
    for (const e of this.events) if (e.type === 'followup.accepted' || e.type === 'followup.dropped') for (const f of e.data?.ids ?? []) s.add(f);
    return s;
  }
  /** Moi prompt followup da accepted (theo thu tu) -> dung lai prompt day du khi phai chay fresh (mat session). */
  acceptedPrompts() {
    return this.events.filter((e) => e.type === 'followup.accepted').flatMap((e) => e.data?.prompts ?? []);
  }
}

function initialState(task) {
  return {
    task_id: task?.task_id,
    backend: task?.backend,
    run_id: task?.run_id ?? null,
    title: task?.title ?? null,
    cwd: task?.cwd ?? null,
    followups: {}, // N10: followup_id -> {turn} | {dropped:true}
    cancel: null, // r3.1 F2: {at, dropped:[followup_id]} cua lan cancel gan nhat da bo followup
    status: 'queued',
    turn: 1,
    attempt: 0,
    session_id: null,
    backend_pid: null,
    progress: null,
    progress_count: 0,
    open_tools: 0,
    failure: null,
    next_retry_at: null,
    failovers: [],
    interruptions: 0,
    last_seq: 0,
    updated_at: null,
  };
}

/** Ap mot su kien vao state (incremental fold). */
export function applyEvent(s, e) {
  s.last_seq = e.seq;
  s.updated_at = e.ts;
  const d = e.data || {};
  switch (e.type) {
    case 'task.created': s.status = 'queued'; break;
    case 'attempt.started':
      s.status = 'running'; s.attempt = e.attempt; s.backend = d.backend ?? s.backend;
      s.backend_pid = d.pid ?? null; s.next_retry_at = null; s.open_tools = 0; break;
    case 'backend.session': s.session_id = d.session_id; break;
    case 'progress': s.progress = d.text; s.progress_count++; if (typeof d.open_tools === 'number') s.open_tools = d.open_tools; break;
    case 'attempt.failed': s.failure = { class: d.class, message: d.message, retriable: d.retriable }; break;
    case 'retry.scheduled': s.status = 'waiting_retry'; s.next_retry_at = d.at; break;
    case 'task.failover': s.failovers.push({ from: d.from, to: d.to }); s.backend = d.to; s.session_id = null; break;
    case 'task.needs_attention': s.status = 'needs_attention'; s.failure = d.failure ?? s.failure; break;
    case 'task.interrupted': s.status = 'interrupted'; s.interruptions++; break;
    case 'task.resumed': s.status = 'queued'; s.interruptions = 0; break;
    case 'attempt.exited': s.backend_pid = null; break;
    case 'followup.accepted':
      s.status = 'queued'; s.turn = (s.turn ?? 1) + 1; s.interruptions = 0; s.failure = null; s.cancel = null;
      s.followups ??= {};
      for (const f of d.ids ?? []) s.followups[f] = { turn: s.turn };
      break;
    case 'followup.dropped':
      s.followups ??= {};
      for (const f of d.ids ?? []) s.followups[f] = { dropped: true, reason: d.reason ?? 'cancel' };
      // r3.1 (F2/M2): lan cancel gan nhat da bo followup -> hien trong brief; xoa khi co followup.accepted moi
      s.cancel = { at: d.cancel_at ?? e.ts, dropped: [...(s.cancel?.dropped ?? []), ...(d.ids ?? [])] };
      break;
    case 'task.completed': s.status = d.status; if (d.status === 'succeeded') s.failure = null; break;
    default: break;
  }
  return s;
}

/** Ham thuan: journal -> trang thai. Day la "su that"; state.json chi la cache cua no. */
export function foldEvents(task, events) {
  const s = initialState(task);
  for (const e of events) applyEvent(s, e);
  return s;
}
