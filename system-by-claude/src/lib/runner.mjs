// Runner: supervisor rieng cho MOT task, chay tach roi khoi GUI (detached). La writer DUY NHAT cua journal khi giu lease.
// r2: lease = named pipe do OS giu (B3); chi runner append (B4); tiep quan -> kill backend mo coi da xac thuc (B10);
// tran gian doan tu journal (B12); no_output (B5); turn (B14); tool dang chay (B15); access/denials (B18); finalize_argv (B19).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { TERMINAL } from './store.mjs';
import { spawnInvocation, killTree, pidAlive, procCreationTime } from './proc.mjs';
import { acquireLease, probeLease } from './lease.mjs';
import { markJobrunBad } from './jobrun.mjs';
import { decide } from './failures.mjs';
import {
  resultContract, parseFinalMessage, repairPrompt, clampSummary, makeEnvelope,
} from './schema.mjs';
import { DEFAULT_HOOKS } from './hooks.mjs';
import { writeJsonAtomic, sleep, relPosix } from './fsutil.mjs';
import { newId } from './ids.mjs';

/** pid backend dang chay trong tien trinh runner nay -> de handler uncaughtException kill (B10). */
export const ACTIVE_CHILDREN = new Set();
export function killActiveChildren() { for (const pid of ACTIVE_CHILDREN) { try { killTree(pid); } catch {} } ACTIVE_CHILDREN.clear(); }

// ---------------- slot (gioi han song song moi backend) - cung bang named pipe: tu nha khi runner chet ----------------
async function acquireSlot(root, backend, { max, isCancelled, onWaiting = () => {}, waitNoticeMs = 30_000 }) {
  const since = Date.now();
  let noticed = false;
  for (;;) {
    for (let i = 0; i < max; i++) {
      const l = await acquireLease(root, `slot-${backend}-${i}`);
      if (l) return l.release;
    }
    if (isCancelled()) return null;
    // D6 (r3): cho slot qua lau -> ghi MOT su kien de orchestrator thay "dang xep hang" thay vi "treo"
    if (!noticed && Date.now() - since >= waitNoticeMs) { noticed = true; try { onWaiting(since); } catch {} }
    await sleep(300 + Math.floor(Math.random() * 300));
  }
}

/**
 * Kill backend cua runner cu NEU van song va dung la tien trinh do (thoi diem tao khop) - chong PID reuse.
 * r3 (N4): dung sai 1s (do Q8a: CreationDate - spawned_at = -7..-2 ms); caller chi goi khi attempt cuoi CHUA co attempt.exited.
 */
export function killVerifiedOrphan(startedEv, { creationTime = procCreationTime, kill = killTree, alive = pidAlive, toleranceMs = 1_000 } = {}) {
  const pid = startedEv?.data?.pid;
  const at = startedEv?.data?.spawned_at;
  if (!pid || !at || !alive(pid)) return { killed: false, reason: 'khong con song' };
  const ct = creationTime(pid);
  if (ct == null) return { killed: false, reason: 'khong doc duoc thoi diem tao' };
  if (Math.abs(ct - at) > toleranceMs) return { killed: false, reason: 'pid da bi tai su dung' };
  kill(pid);
  return { killed: true, pid };
}

function gitSnapshot(cwd) {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    return r.status === 0 ? r.stdout : null;
  } catch { return null; }
}

/**
 * Chay mot task den khi ket thuc / park / huy. An toan khi goi lai nhieu lan va khi nhieu runner cung khoi dong
 * (chi mot ben chiem duoc lease; ben kia tra {skipped:'lease_held'} ngay).
 * @param {import('./store.mjs').TaskStore} store
 * @param {string} id
 * @param {{adapters: Record<string, object>, hooks?: object, pollMs?: number, maxPerBackend?: number, workerMcpConfig?: string}} opts
 */
export async function runTask(store, id, opts) {
  const hooks = { ...DEFAULT_HOOKS, ...(opts.hooks ?? {}) };
  const runnerId = newId('r');
  const live = { runner_id: runnerId, pid: process.pid, attempt: 0, backend_pid: null, poke: () => {} };
  const lease = await acquireLease(store.root, `task-${id}`, {
    info: () => ({ runner_id: runnerId, pid: process.pid, attempt: live.attempt, backend_pid: live.backend_pid }),
    onPoke: () => live.poke(),
  });
  if (!lease) {
    // r3.1 (F1/M1): listen bao "held" ca khi pipe la cua tien trinh khac quyen (libuv: ACCESS_DENIED -> EADDRINUSE).
    // Probe mot lan: EPERM/EACCES -> nem lease_permission (runner-main ghi runner.fatal.json -> hub tra runner_failed).
    const p = await probeLease(store.root, `task-${id}`, { timeoutMs: 1000 });
    if (p.alive === 'foreign') throw Object.assign(new Error(`lease_permission: pipe task-${id} do tien trinh khac quyen giu (${p.code}); GUI chay "Run as administrator" dung chung ORCH_HOME voi GUI thuong? -> dat ORCH_HOME rieng`), { code: 'lease_permission' });
    return { skipped: 'lease_held' };
  }
  try {
    return await runLoop(store, id, opts, hooks, live);
  } finally {
    await lease.release();
  }
}

/** Con viec cho runner sau khi nha lease? (followup / cancel tren task chua xong / resume tren task bi park) */
export function hasWork(store, id) {
  if (store.pendingFollowups(id) > 0) return true; // followup da bi cancel da nam o control/dropped/ -> khong tinh (N1)
  const st = store.state(id);
  if (store.cancelRequested(id) && !TERMINAL.has(st.status)) return true;
  if (store.readRequest(id, 'resume') && st.status === 'needs_attention') return true;
  return false;
}

/**
 * Vong ngoai cua tien trinh runner: sau khi NHA lease, kiem lai control/. Hub ghi control TRUOC khi probe lease, nen neu hub
 * thay lease con giu (khong launch), viec cua no chac chan duoc thay o lan kiem nay -> khong bo sot followup/cancel/resume.
 */
export async function runTaskLoop(store, id, opts, { maxRounds = 100, log = () => {} } = {}) {
  let r;
  for (let i = 0; i < maxRounds; i++) {
    r = await runTask(store, id, opts);
    log(`ket thuc vong: ${JSON.stringify({ status: r.status, skipped: r.skipped, note: r.note })}`);
    if (r.skipped || !hasWork(store, id)) break;
  }
  return r;
}

async function runLoop(store, id, opts, hooks, live) {
  const j = store.openJournal(id);
  const spec = j.task;
  const pollMs = opts.pollMs ?? 200;
  const isCancelled = () => !!store.cancelRequested(id);
  const append = (type, data, attempt) => {
    const ev = j.append(type, data, attempt);
    try { hooks.on_event({ task_id: id, event: ev }); } catch {}
    return ev;
  };

  if (j.empty) append('task.created', { backend: spec.backend, run_id: spec.run_id ?? null, title: spec.title ?? null });
  let st = j.state;
  let backend = st.backend === 'auto' || !st.backend ? hooks.route(spec) : st.backend;
  let sessionId = st.session_id;
  let attempt = st.attempt;
  const usages = [];
  let denials = [];
  let unknownEvents = 0; // D7: dong JSON parser khong nhan ra (canary doi format backend)
  // r3.1 F3: jobrun hong/bi chan (luc chay -> chay lai khong jobrun; hoac ensureJobrun da tra null -> runner-main bao qua opts)
  let jobrunUnavailable = !!opts.jobrunUnavailableReason;

  // ---------- helper ket thuc (dinh nghia truoc vi janitor/park dung som) ----------
  const refs = () => {
    const dir = store.taskDir(id);
    return {
      events: relPosix(store.root, path.join(dir, 'events.jsonl')),
      transcript_dir: relPosix(store.root, path.join(dir, 'attempts')),
      final_message: relPosix(store.root, path.join(dir, 'artifacts', 'final-message.md')),
    };
  };
  const saveFinal = (text) => fs.writeFileSync(path.join(store.artifactsDir(id), 'final-message.md'), text ?? '');
  const notifyAll = (n) => {
    try { store.notify(id, { run_id: spec.run_id ?? null, title: spec.title ?? null, cwd: spec.cwd ?? null, ...n }); } catch {}
    try { hooks.on_notify({ task_id: id, title: spec.title, ...n }); } catch {}
  };
  /**
   * N1 (r3): tieu thu yeu cau huy. Moi followup gui TRUOC (hoac cung luc) cancel.at thuoc ve y dinh da bi huy -> chuyen sang
   * control/dropped/ + followup.dropped; followup gui SAU cancel la viec moi -> giu lai (hasWork se chay turn moi).
   */
  const consumeCancel = () => {
    const c = store.cancelRequested(id);
    if (!c) return;
    const victims = store.peekFollowups(id).filter((f) => !c.at || !f.at || f.at <= c.at);
    if (victims.length) {
      append('followup.dropped', { ids: victims.map((f) => f.followup_id), count: victims.length, reason: 'cancel', cancel_at: c.at ?? null });
      store.dropFollowups(id, victims.map((f) => f.file));
    }
    store.clearCancel(id);
  };
  let gitBefore = null;
  const finish = (status, fields) => {
    const warnings = [...(fields.warnings ?? [])];
    if (denials.length) warnings.push('permission_denied');
    if (status === 'succeeded' && spec.access === 'write' && !(fields.changed_files?.length) && gitBefore !== null && gitSnapshot(spec.cwd) === gitBefore) warnings.push('no_changes');
    // D2 (r3): huy = kill cung. Task ghi ma workspace da doi -> canh bao co the con thay doi dang do.
    if (status === 'cancelled' && spec.access === 'write' && attempt > 0 && gitBefore !== null) {
      const now = gitSnapshot(spec.cwd);
      if (now !== null && now !== gitBefore) warnings.push('killed_mid_write');
    }
    if (unknownEvents > 0) warnings.push(`unknown_events:${unknownEvents}`);
    if (jobrunUnavailable) warnings.push('jobrun_unavailable');
    let env = makeEnvelope({
      task_id: id, run_id: spec.run_id, turn: j.state.turn, backend, status, session_id: sessionId,
      usage: { per_attempt: usages }, attempts: attempt, failovers: j.state.failovers, refs: refs(), denials, ...fields, warnings,
    });
    env = hooks.on_result({ spec, envelope: env }) ?? env;
    store.writeResult(id, env);
    append('task.completed', { status, format: env.format, turn: env.turn });
    consumeCancel(); // N1: ke ca khi turn ket thuc DUNG luc cancel toi -> followup truoc cancel bi bo, khong mo turn moi
    store.clearRequest(id, 'resume');
    notifyAll({ status, backend, turn: env.turn, summary_head: (env.summary ?? '').slice(0, 200) });
    return { status, envelope: env };
  };
  const park = (failure, reason) => {
    append('task.needs_attention', { failure, reason });
    notifyAll({ status: 'needs_attention', backend, reason, failure_class: failure?.class });
    try { hooks.on_park({ spec, failure }); } catch {}
    return { status: 'needs_attention' };
  };

  // ---------- tiep quan: runner truoc chet giua chung (B10, B12) ----------
  if (['running', 'waiting_retry', 'interrupted'].includes(st.status)) {
    // N4 (r3): chi kill khi attempt cuoi CHUA thoat (khong co attempt.exited). waiting_retry: backend da thoat -> pid co the
    // da bi tai su dung cho tien trinh khong lien quan -> khong bao gio kill.
    const orphan = j.lastAttemptExited() ? { killed: false, reason: 'attempt cuoi da thoat (attempt.exited)' } : killVerifiedOrphan(j.lastOf('attempt.started'), opts.orphanOpts);
    append('task.interrupted', { reason: 'runner truoc khong con song', orphan });
    st = j.state;
    if (j.interruptionsThisTurn() > spec.limits.max_interruptions) {
      return park({ class: 'poison', message: `bi gian doan ${j.interruptionsThisTurn()} lan trong turn nay` }, 'qua tran max_interruptions');
    }
  }

  // ---------- huy truoc khi chay (janitor - B4: hub khong tu ghi journal) ----------
  if (store.cancelRequested(id)) {
    if (TERMINAL.has(st.status)) consumeCancel(); // N1: task da xong -> van phai bo followup gui truoc cancel
    else return finish('cancelled', { error: { class: 'cancelled', message: store.cancelRequested(id).reason ?? 'user' } });
  }

  // prompt day du cho lan chay FRESH (mat session / failover): prompt goc + moi followup da accepted (khong mat yeu cau bo sung)
  const fullPrompt = (contract = true) => {
    const extra = j.acceptedPrompts();
    return spec.prompt + (extra.length ? '\n\nYEU CAU BO SUNG (theo thu tu):\n' + extra.join('\n\n') : '') + (contract ? resultContract(spec) : '');
  };

  // ---------- chon diem vao ----------
  let prompt;
  let mode;
  // N10 (r3): doc -> ghi followup.accepted{ids,prompts} -> moi xoa file. Chet giua chung: file con nhung id da accepted -> bo qua.
  const handled = j.handledFollowupIds();
  const peeked = store.peekFollowups(id);
  store.ackFollowups(id, peeked.filter((f) => handled.has(f.followup_id)).map((f) => f.file));
  const followups = peeked.filter((f) => !handled.has(f.followup_id));
  if (followups.length) {
    const extra = followups.map((f) => f.prompt).join('\n\n');
    append('followup.accepted', { count: followups.length, ids: followups.map((f) => f.followup_id), prompts: followups.map((f) => f.prompt) });
    store.ackFollowups(id, followups.map((f) => f.file));
    mode = sessionId ? 'resume' : 'fresh';
    prompt = sessionId ? extra + resultContract(spec) : fullPrompt();
    store.clearRequest(id, 'resume');
  } else if (TERMINAL.has(st.status)) {
    store.clearRequest(id, 'resume');
    return { status: st.status, note: 'da ket thuc' };
  } else if (st.status === 'needs_attention') {
    if (!store.readRequest(id, 'resume')) return { status: 'needs_attention', note: 'cho subagent_resume' };
    store.clearRequest(id, 'resume');
    append('task.resumed', {});
    prompt = sessionId ? continuationPrompt(spec) : fullPrompt();
    mode = sessionId ? 'resume' : 'fresh';
  } else if (attempt > 0) {
    store.clearRequest(id, 'resume');
    if (hooks.pre_resume({ spec, backend, reason: 'interrupted' })?.allow === false) return park({ class: 'policy', message: 'pre_resume tu choi' }, 'pre_resume');
    prompt = sessionId ? continuationPrompt(spec) : fullPrompt();
    mode = sessionId ? 'resume' : 'fresh';
  } else {
    prompt = spec.prompt + resultContract(spec);
    mode = 'fresh';
  }

  if (spec.access === 'write') gitBefore = gitSnapshot(spec.cwd);
  let repairs = 0;
  let attemptsThisRun = 0;
  let nativeSchemaOff = false;
  const classCounts = {};
  const turnStarted = Date.now();
  const failoverPool = (spec.failover ?? []).filter((b) => b !== backend && opts.adapters[b]);

  for (;;) {
    if (isCancelled()) return finish('cancelled', { error: { class: 'cancelled', message: store.cancelRequested(id)?.reason ?? 'user' } });
    if (Date.now() - turnStarted > spec.limits.total_timeout_ms) {
      return finish('failed', { error: { class: 'hang', message: `vuot total_timeout_ms ${spec.limits.total_timeout_ms}`, retriable: true } });
    }
    const adapter = opts.adapters[backend];
    if (!adapter) return park({ class: 'config', message: `khong co adapter '${backend}'` }, 'thieu adapter');

    const release = await acquireSlot(store.root, backend, {
      max: opts.maxPerBackend ?? 3, isCancelled, waitNoticeMs: opts.slotWaitNoticeMs ?? 30_000,
      onWaiting: (since) => append('slot.waiting', { backend, since: new Date(since).toISOString(), max: opts.maxPerBackend ?? 3 }),
    });
    if (!release) continue;
    attempt += 1;
    attemptsThisRun += 1;
    live.attempt = attempt;
    let out;
    try {
      out = await runAttempt({ store, id, spec, adapter, backend, prompt, sessionId, attempt, mode, hooks, append, isCancelled, pollMs, opts, live, nativeSchemaOff });
    } finally {
      await release();
      live.backend_pid = null;
    }
    if (out.jobrunUnavailable) jobrunUnavailable = true;
    if (out.unknownEvents) unknownEvents += out.unknownEvents;
    if (out.usage) usages.push({ attempt, backend, ...out.usage });
    if (out.sessionId) sessionId = out.sessionId;
    if (out.denials?.length) denials = out.denials;

    if (out.cancelled) return finish('cancelled', { error: { class: 'cancelled', message: 'huy theo yeu cau' } });

    if (!out.failure) {
      const parsed = parseFinalMessage(spec, out.finalText);
      if (parsed.ok) return finishWithContract(parsed.value, out.finalText);
      if (repairs < spec.limits.max_repairs && sessionId && adapter.capabilities.resume) {
        repairs += 1;
        append('output.repair_requested', { errors: parsed.errors.slice(0, 5) }, attempt);
        prompt = repairPrompt(spec, parsed.errors);
        mode = 'resume';
        continue;
      }
      return finishDegraded(out.finalText, parsed.errors);
    }

    // --- that bai: phan loai -> quyet dinh ---
    const f = out.failure;
    classCounts[f.class] = (classCounts[f.class] ?? 0) + 1;
    append('attempt.failed', { class: f.class, message: f.message?.slice(0, 1000), retriable: !['auth', 'config', 'agent_failed', 'permission'].includes(f.class) }, attempt);
    if (f.schemaRejected && !nativeSchemaOff) {
      // Codex tu choi schema native -> thu lai MOT lan khong co --output-schema (hub validate + repair) (B2d)
      nativeSchemaOff = true;
      attemptsThisRun -= 1;
      append('native_schema.disabled', { reason: f.message?.slice(0, 300) }, attempt);
      continue;
    }
    const d = decide(f, {
      attempt: attemptsThisRun,
      maxAttempts: spec.limits.max_attempts,
      hasSession: !!sessionId && adapter.capabilities.resume,
      failoverCandidates: failoverPool,
      lastMode: mode,
      classCount: classCounts[f.class],
    });

    if (d.action === 'cancel') return finish('cancelled', { error: { class: 'cancelled', message: f.message } });
    if (d.action === 'failover') {
      const allowed = hooks.pre_failover({ spec, from: backend, to: d.to, failure: f })?.allow !== false;
      if (!allowed) return park(f, 'pre_failover tu choi');
      append('task.failover', { from: backend, to: d.to, reason: d.reason });
      failoverPool.splice(failoverPool.indexOf(d.to), 1);
      backend = d.to;
      sessionId = null;
      attemptsThisRun = 0;
      prompt = fullPrompt(false) + `\n\nLUU Y: lan chay truoc tren backend khac that bai (${f.class}). Workspace co the co thay doi dang do - kiem tra (vd git status) truoc khi lam tiep.` + resultContract(spec);
      mode = 'fresh';
      continue;
    }
    if (d.action === 'retry' || d.action === 'resume') {
      const at = new Date(Date.now() + (d.delayMs ?? 0)).toISOString();
      append('retry.scheduled', { at, delay_ms: d.delayMs ?? 0, mode: d.action, reason: d.reason }, attempt);
      const until = Date.now() + (d.delayMs ?? 0);
      while (Date.now() < until) { if (isCancelled()) break; await sleep(Math.min(pollMs, until - Date.now())); }
      if (d.action === 'resume') { prompt = continuationPrompt(spec); mode = 'resume'; }
      else { sessionId = null; prompt = fullPrompt(); mode = 'fresh'; }
      continue;
    }
    if (d.action === 'park') return park(f, d.reason);
    return finish('failed', { error: { class: f.class, message: f.message, retriable: false } });
  }

  function finishWithContract(v, rawText) {
    saveFinal(rawText);
    const status = v.status === 'failed' ? 'failed' : v.status === 'needs_input' ? 'needs_input' : 'succeeded';
    return finish(status, {
      summary: clampSummary(v.summary, spec.summary_max_chars, refs().final_message),
      outputs: v.outputs ?? {},
      artifacts: (v.artifacts ?? []).map((a) => ({ ...a, abs: path.resolve(spec.cwd, a.path) })),
      changed_files: v.changed_files ?? [],
      questions: v.questions ?? [],
      error: status === 'failed' ? { class: 'agent_failed', message: v.summary?.slice(0, 500), retriable: false } : null,
    });
  }
  // Chi goi khi co text KHONG rong (B5).
  // N14 (r3) chinh sach: nguoi goi KHAI BAO output_schema (may can outputs) -> failed/bad_output (giu text trong summary);
  // khong khai bao -> succeeded + format:'degraded' + warnings:['unverified_format'] (text tu do van dung duoc cho nguoi doc).
  function finishDegraded(text, errors) {
    saveFinal(text);
    if (spec.output_schema) {
      return finish('failed', {
        format: 'degraded',
        summary: clampSummary(text, spec.summary_max_chars, refs().final_message),
        warnings: ['unverified_format'],
        outputs: { contract_errors: errors.slice(0, 3) },
        error: { class: 'bad_output', message: `tin nhan cuoi khong dung hop dong sau ${spec.limits.max_repairs} lan sua: ${errors.slice(0, 2).join('; ')}`.slice(0, 500), retriable: false },
      });
    }
    return finish('succeeded', {
      format: 'degraded',
      summary: clampSummary(text, spec.summary_max_chars, refs().final_message),
      warnings: ['unverified_format'],
      outputs: { contract_errors: errors.slice(0, 3) },
      error: null,
    });
  }
}

function continuationPrompt(spec) {
  return 'Phien lam viec truoc bi gian doan (tien trinh bi dung/loi tam thoi). Tiep tuc cong viec dang do tu trang thai hien tai; '
    + 'neu da hoan thanh thi chi tra ket qua.' + resultContract(spec);
}

/** D7: ORCH_CAPTURE_GOLDEN=1 -> chep raw.jsonl that vao <root>/golden/ de lam fixture "captured" (thay fixture "doc-derived"). */
function captureGolden(root, backend, rawFile, stream) {
  const go = () => {
    try {
      const dir = path.join(root, 'golden');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(rawFile, path.join(dir, `${backend}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`));
    } catch {}
  };
  if (stream.writableFinished) go(); else stream.once('finish', go);
}

// ---------------- mot lan chay backend ----------------
// r3.1 (F3/M3): jobrun hong (exe 0 byte, AV cat/cach ly, AppLocker/WDAC/ASR chan) hoac loi noi bo (exit 120-123 + "[jobrun]")
// -> danh dau .bad (ca runner sau cung khong thu lai trong 24h), chay lai CHINH attempt nay truc tiep, KHONG tinh vao
// max_attempts, envelope co warnings:['jobrun_unavailable']. Exit 126/127 la loi CreateProcess cua BACKEND (vd ENOENT) -> khong
// phai loi jobrun.
const JOBRUN_SPAWN_ERRS = new Set(['EFTYPE', 'EACCES', 'EPERM', 'UNKNOWN', 'ENOENT', 'EINVAL']);
// ENOENT ma exe van con (cwd khong ton tai, ...) KHONG phai loi cua jobrun -> khong danh dau .bad
const nonEmptyFile = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };
const jobrunFault = (e, exe) => !!e && JOBRUN_SPAWN_ERRS.has(e.code) && !(e.code === 'ENOENT' && exe && nonEmptyFile(exe));
async function runAttempt(ctx) {
  const out = await runAttemptOnce(ctx);
  if (!out.jobrunBroken) return out;
  const { opts, append, attempt } = ctx;
  markJobrunBad(opts.jobrunExe, out.jobrunBroken);
  append('jobrun.unavailable', { exe: opts.jobrunExe, reason: out.jobrunBroken }, attempt);
  opts.jobrunExe = null; // phan con lai cua runner nay chay truc tiep
  const again = await runAttemptOnce(ctx);
  return { ...again, jobrunUnavailable: true };
}

async function runAttemptOnce(ctx) {
  const { store, id, spec, adapter, backend, prompt, sessionId, attempt, mode, hooks, append, isCancelled, pollMs, opts, live, nativeSchemaOff } = ctx;
  const attemptDir = store.attemptDir(id, attempt);
  const pa = hooks.pre_attempt({ spec, backend, attempt, mode }) ?? {};
  if (pa.deny) return { failure: { class: 'config', message: `pre_attempt tu choi: ${pa.deny}` } };
  if (spec.access === 'write' && !pa.grants?.write) {
    return { failure: { class: 'config', message: 'access=write nhung policy chua cap quyen ghi (pre_attempt phai tra grants.write + co sandbox/permission tuong ung) - khong chay backend de tranh "thanh cong ma khong lam gi"' } };
  }
  const inv = adapter.buildInvocation({
    spec, prompt, sessionId: mode === 'resume' ? sessionId : null, attemptDir,
    extraArgs: pa.extraArgs ?? [], workerMcpConfig: opts.workerMcpConfig, nativeSchemaOff,
  });
  inv.args = hooks.finalize_argv({ spec, backend, command: inv.command, args: [...inv.args] }) ?? inv.args;
  inv.env = { ...(inv.env ?? {}), ...(pa.env ?? {}), ORCH_DEPTH: String(spec.depth ?? 1), ORCH_PARENT_TASK: id };
  writeJsonAtomic(path.join(attemptDir, 'invocation.json'), { command: inv.command, args: inv.args, cwd: inv.cwd, mode, backend });

  inv.jobrunExe = opts.jobrunExe ?? null; // N5: Windows -> backend chay trong job KILL_ON_JOB_CLOSE rieng
  let child;
  try {
    child = spawnInvocation(inv);
  } catch (e) {
    if (inv.jobrunExe && jobrunFault(e, inv.jobrunExe)) return { jobrunBroken: `spawn ${e.code}: ${e.message}` };
    return { failure: { class: e.code === 'ENOENT' ? 'config' : 'crash', message: e.message } };
  }
  const viaJobrun = String(child.via ?? '').startsWith('jobrun');
  const spawnedAt = Date.now();
  if (child.pid) { ACTIVE_CHILDREN.add(child.pid); live.backend_pid = child.pid; }
  append('attempt.started', { backend, pid: child.pid ?? null, spawned_at: spawnedAt, mode, via: child.via ?? null, session_id: mode === 'resume' ? sessionId : null }, attempt);

  const raw = fs.createWriteStream(path.join(attemptDir, 'raw.jsonl'));
  const errLog = fs.createWriteStream(path.join(attemptDir, 'stderr.log'));
  const acc = { resumed: mode === 'resume', session_id: mode === 'resume' ? sessionId : null };
  let stderrTail = '';
  let lastActivity = Date.now();
  let pendingProgress = null;
  let lastProgressAt = 0;
  let tools = 0;
  const openTools = new Set();
  let killedFor = null;
  let spawnError = null;
  let unknown = 0;
  const unknownNames = new Set();

  const flushProgress = (force = false) => {
    if (!pendingProgress) return;
    if (!force && Date.now() - lastProgressAt < 1000) return; // gop su kien: journal khong phinh
    append('progress', { text: pendingProgress.slice(0, 300), tools, open_tools: openTools.size }, attempt);
    pendingProgress = null;
    lastProgressAt = Date.now();
  };

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    // Moi loi trong handler deu bi nuot o day: mot dong la khong duoc lam chet runner (B10).
    try {
      lastActivity = Date.now();
      raw.write(line + '\n');
      let evs = [];
      try { evs = adapter.parseLine(line, acc) ?? []; } catch (e) { evs = [{ kind: 'error', text: `parse: ${e.message}` }]; }
      if (adapter.knownTypes && line.charCodeAt(0) === 123 /* { */) {
        let k; try { const o = JSON.parse(line); k = o?.type ?? o?.event; } catch {}
        if (k !== undefined && !adapter.knownTypes.has(k)) { unknown += 1; if (unknownNames.size < 5) unknownNames.add(String(k).slice(0, 40)); }
      }
      for (const ev of evs) {
        if (ev.kind === 'session') append('backend.session', { session_id: ev.session_id }, attempt);
        else if (ev.kind === 'progress') { pendingProgress = ev.text; flushProgress(); }
        else if (ev.kind === 'tool_start') { tools += 1; openTools.add(ev.id ?? `t${tools}`); pendingProgress = pendingProgress ?? `tool: ${ev.name}`; flushProgress(); }
        else if (ev.kind === 'tool_end') { openTools.delete(ev.id); }
        else if (ev.kind === 'tool') { tools += 1; pendingProgress = pendingProgress ?? `tool: ${ev.name}`; flushProgress(); }
        else if (ev.kind === 'final') acc.final = ev;
        else if (ev.kind === 'error') acc.errorText = ((acc.errorText ?? '') + '\n' + ev.text).slice(-4000);
      }
    } catch (e) {
      try { errLog.write(`[runner] loi xu ly dong: ${e.message}\n`); } catch {}
    }
  });
  child.stderr.on('data', (d) => {
    lastActivity = Date.now();
    errLog.write(d);
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  child.stdin.on('error', () => {});
  // Dong stdin sau prompt: Claude/Codex doc het stdin; agy stream-json: EOF = hoan tat turn roi thoat 0 [DKC notebook r2].
  child.stdin.end(inv.stdin ?? '');

  const check = () => {
    try {
      if (killedFor) return;
      const now = Date.now();
      const idleLimit = openTools.size ? spec.limits.tool_idle_timeout_ms : spec.limits.idle_timeout_ms;
      if (isCancelled()) killedFor = 'cancelled';
      else if (now - lastActivity > idleLimit) killedFor = 'hang';
      else if (now - spawnedAt > spec.limits.wall_timeout_ms) killedFor = 'wall';
      // D4 (r3): co jobrun -> chi TerminateProcess(jobrun); OS dong handle job -> KILL_ON_JOB_CLOSE giet ca cay (ke ca chau
      // da dut ParentProcessId). Khong goi taskkill /T (duyet WMI, co the treo - openai/codex #34260). Khong co jobrun -> nhu r2.
      if (killedFor) { if (String(child.via ?? '').startsWith('jobrun')) child.kill(); else killTree(child.pid); }
    } catch {}
  };
  const timer = setInterval(check, pollMs);
  live.poke = check; // hub "poke" qua pipe -> kiem tra huy ngay, khong doi chu ky poll

  const code = await new Promise((resolve) => {
    child.on('error', (e) => { spawnError = e; });
    child.on('close', (c) => resolve(c));
  });
  clearInterval(timer);
  live.poke = () => {};
  ACTIVE_CHILDREN.delete(child.pid);
  rl.close();
  flushProgress(true); // r3.1 (M10): progress cuoi ghi TRUOC attempt.exited
  // N4 (r3): ghi NGAY khi backend thoat -> runner tiep quan biet pid nay khong con la cua ta (khong kill nham khi PID reuse)
  append('attempt.exited', { code, pid: child.pid ?? null, killed_for: killedFor }, attempt);
  raw.end(); errLog.end();
  if (process.env.ORCH_CAPTURE_GOLDEN === '1') captureGolden(store.root, backend, path.join(attemptDir, 'raw.jsonl'), raw);
  if (unknown) append('parser.unknown_events', { count: unknown, types: [...unknownNames] }, attempt);

  if (viaJobrun && !killedFor) {
    if (jobrunFault(spawnError, inv.jobrunExe)) return { jobrunBroken: `spawn ${spawnError.code}: ${spawnError.message}` };
    if (code >= 120 && code <= 123 && /^\[jobrun\]/.test(stderrTail.trimStart())) return { jobrunBroken: stderrTail.trim().split(String.fromCharCode(10))[0].trim().slice(0, 300) };
  }
  const result = { sessionId: acc.session_id, usage: acc.final?.usage ?? null, denials: acc.denials ?? [], unknownEvents: unknown };
  if (killedFor === 'cancelled') return { ...result, cancelled: true };
  if (killedFor === 'hang') return { ...result, failure: { class: 'hang', message: `khong co output trong ${openTools.size ? spec.limits.tool_idle_timeout_ms : spec.limits.idle_timeout_ms}ms (tool dang mo: ${openTools.size})` } };
  if (killedFor === 'wall') return { ...result, failure: { class: 'hang', message: `vuot wall timeout ${spec.limits.wall_timeout_ms}ms` } };
  if (spawnError) return { ...result, failure: { class: spawnError.code === 'ENOENT' ? 'config' : 'crash', message: spawnError.message } };

  if ((!acc.final || !String(acc.final.text ?? '').trim()) && adapter.finalize) {
    const f = adapter.finalize(acc, inv);
    if (f) acc.final = { ...(acc.final ?? {}), kind: 'final', text: f.text, is_error: acc.final?.is_error ?? false };
  }
  const clean = code === 0 && acc.final && !acc.final.is_error;
  if (!clean) {
    const failure = adapter.classifyExit?.({ code, stderrTail, acc, inv })
      ?? (acc.final || code === 0 ? null : { class: 'crash', message: `exit ${code}, khong co tin nhan cuoi` });
    if (failure) return { ...result, failure };
  }
  if (!acc.final || !String(acc.final.text ?? '').trim()) {
    // B5: thoat 0 ma khong co tin nhan cuoi (agy #76, soft-deny, refused turn) -> KHONG BAO GIO la succeeded
    if (unknown > 0) {
      // D7: co dong ma parser khong nhan ra VA khong tim duoc tin nhan cuoi -> nhieu kha nang backend doi format
      return { ...result, failure: { class: 'bad_output', message: `parser_unrecognized: ${unknown} dong loai la (${[...unknownNames].join(', ')}), khong co tin nhan cuoi - kiem tra phien ban backend / bat ORCH_CAPTURE_GOLDEN=1` } };
    }
    return { ...result, failure: { class: 'no_output', message: `backend thoat ${code} nhung khong co tin nhan cuoi (stdout ${acc.final ? 'co result rong' : 'khong co result'})` } };
  }
  return { ...result, finalText: acc.final.text };
}
