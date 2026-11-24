// Hub: mat tien KHONG CHAN cho orchestrator. Moi lenh tra ve ngay (ms); viec nang do runner tach roi lam.
// Cung mot API cho ca 3 backend: spawn / run / status / wait / result / cancel / followup / resume / list / reconcile / notifications.
// r2 (B4): Hub KHONG BAO GIO ghi journal. No chi ghi task.json (khi tao), control/ (yeu cau), roi launch runner;
// runner chiem lease (named pipe) va la ben duy nhat ghi su kien.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TaskStore, TERMINAL, cwdWithin } from './store.mjs';
import { normalizeSpec, pickPublicSpec } from './schema.mjs';
import { probeLease } from './lease.mjs';
import { processAncestryAsync } from './proc.mjs';
import { DEFAULT_HOOKS } from './hooks.mjs';
import { sleep } from './fsutil.mjs';
import { createClaudeAdapter } from './adapters/claude-code.mjs';
import { createCodexAdapter } from './adapters/codex.mjs';
import { createAntigravityAdapter } from './adapters/antigravity.mjs';
import { createFakeAdapter } from './adapters/fake.mjs';

const RUNNER_MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/runner-main.mjs');
const RUNNER_TRAMPOLINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/runner-trampoline.mjs');

export function defaultAdapters() {
  const a = { claude: createClaudeAdapter(), codex: createCodexAdapter(), antigravity: createAntigravityAdapter() };
  if (process.env.ORCH_ENABLE_FAKE === '1') { a.fake = createFakeAdapter(); a.fake2 = createFakeAdapter({ id: 'fake2' }); }
  return a;
}

/**
 * Launcher mac dinh: node tach roi. [DKC P6/P7 cua phan bien] tien trinh detached thoat khoi job KILL_ON_JOB_CLOSE cua libuv
 * -> song sot khi MCP server/GUI dong; con rui ro host chu dong TerminateJobObject -> do bang `orch doctor`.
 */
// D4b (r3): mac dinh di qua bac dem runner-trampoline.mjs de runner KHONG nam trong cay PID cua MCP server
// (host GUI don bang `taskkill /T` se khong cham toi runner). ORCH_LAUNCH_DIRECT=1 -> spawn truc tiep nhu r2.
export function detachedLauncher(root, env = process.env) {
  const target = env.ORCH_LAUNCH_DIRECT === '1' ? RUNNER_MAIN : RUNNER_TRAMPOLINE;
  return (taskId) => {
    const child = spawn(process.execPath, [target, '--root', root, taskId], {
      detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ORCH_HOME: root },
    });
    child.on('error', () => {});
    child.unref();
    return child.pid;
  };
}

/** Ham thuan (B9): neu mot to tien cua tien trinh nay la backend cua task dang chay -> day la loi goi tu worker. */
export function detectParentTask(ancestors, running) {
  const set = new Set(ancestors);
  for (const t of running) if (t.backend_pid && set.has(t.backend_pid)) return t;
  return null;
}

// runner_failed (r3, N3) khong nam trong journal: hub suy ra tu runner.fatal.json / launch lap lai -> wait coi la xong.
const isDone = (s) => TERMINAL.has(s.status) || s.status === 'needs_attention' || s.status === 'runner_failed';
const LAUNCH_FAIL_COUNT = 3;
const LAUNCH_FAIL_WINDOW_MS = 60_000;
const LAUNCH_FAIL_MIN_SPAN_MS = 15_000; // r3.1 (M5): launch cu nhat phai >= 15s (khoi dong cham do AV/may tai khong bi coi la hong)
const LAUNCH_THROTTLE_MS = 5_000;       // r3.1 (M5): chan launch THEO STORE (moi tien trinh hub dung chung), khong theo bo nho

export class Hub {
  /** @param {{root?: string, launcher?: (id:string)=>any, hooks?: object, ancestry?: () => number[]}} o */
  constructor(o = {}) {
    this.store = new TaskStore(o.root);
    this.launch = o.launcher ?? detachedLauncher(this.store.root);
    this.hooks = { ...DEFAULT_HOOKS, ...(o.hooks ?? {}) };
    this.maxDepth = parseInt(process.env.ORCH_MAX_DEPTH ?? '2', 10);
    this.maxActive = parseInt(process.env.ORCH_MAX_ACTIVE ?? '8', 10);
    this.maxActivePerCwd = parseInt(process.env.ORCH_MAX_ACTIVE_PER_CWD ?? '4', 10); // N6: store dung chung -> them tran theo project
    this.ancestryFn = o.ancestry ?? (() => processAncestryAsync(process.pid)); // N13: bat dong bo
    this._ancestry = null;
    this._lastLaunch = new Map();
  }

  /** @param {{force?: boolean}} o  force: bo qua chan theo store (spawn task moi, resume sau khi xoa dau loi). */
  _launch(id, { force = false } = {}) {
    // r3.1 (M5): MCP server, `orch wait --until-done`, `orch status` la cac tien trinh khac nhau -> chan bang file launch-* tren
    // store: co launch trong 5s gan nhat thi khong launch nua (runner dang khoi dong se tu doc control/).
    if (!force) {
      const last = this.store.launches(id).at(-1) ?? 0;
      if (Date.now() - last < LAUNCH_THROTTLE_MS) return null;
    }
    this._lastLaunch.set(id, Date.now());
    this.store.recordLaunch(id); // N3: dau vet launch -> phat hien runner khong khoi dong duoc
    return this.launch(id);
  }

  /**
   * N3 (r3): runner co khoi dong duoc khong? -> null | {class:'runner_failed', message, log_tail}
   * (a) runner.fatal.json (runner ghi khi loi khoi dong/loi khong bat duoc/lease_permission), hoac
   * (b) >= 3 lan launch trong 60s gan nhat ma KHONG co runner.started nao moi hon lan launch cu nhat trong so do
   *     (node khong chay noi runner-main: duong dan sai, AV chan, ...).
   */
  runnerFailure(id) {
    const f = this.store.runnerFatal(id);
    if (f) return { class: String(f.message).startsWith('lease_permission') ? 'lease_permission' : 'runner_failed', message: String(f.message).split('\n')[0].slice(0, 500), at: new Date(f.at).toISOString(), log_tail: this.store.logTail(id) };
    const now = Date.now();
    const started = this.store.runnerStarted(id)?.at ?? 0;
    const recent = this.store.launches(id).filter((t) => t > started && now - t <= LAUNCH_FAIL_WINDOW_MS);
    if (recent.length >= LAUNCH_FAIL_COUNT && now - recent[0] >= LAUNCH_FAIL_MIN_SPAN_MS) {
      return { class: 'runner_failed', message: `${recent.length} lan launch runner trong ${Math.round((now - recent[0]) / 1000)}s ma runner khong khoi dong (khong co runner.started)`, log_tail: this.store.logTail(id) };
    }
    return null;
  }

  activeTasks() {
    const out = [];
    for (const id of this.store.listTaskIds()) {
      let s; try { s = this.store.state(id); } catch { continue; }
      if (!isDone(s)) out.push({ ...s, depth: safeDepth(this.store, id), cwd: s.cwd ?? safeCwd(this.store, id) });
    }
    return out;
  }

  /** Do sau cua loi goi nay: ORCH_DEPTH (neu env toi duoc) hoac to tien la backend cua task dang chay (khong phu thuoc env). */
  async callerDepth(active) {
    const envDepth = parseInt(process.env.ORCH_DEPTH ?? '0', 10) || 0;
    if (envDepth > 0 || process.env.ORCH_ANCESTRY_CHECK === '0') return { depth: envDepth, parent: process.env.ORCH_PARENT_TASK ?? null };
    const running = active.filter((t) => t.backend_pid);
    if (!running.length) return { depth: 0, parent: null }; // khong co backend nao dang chay -> khong the la worker
    this._ancestry ??= await this.ancestryFn();
    const p = detectParentTask(this._ancestry, running);
    return p ? { depth: p.depth ?? 1, parent: p.task_id } : { depth: 0, parent: null };
  }

  /**
   * Giao viec. Tra ve ngay voi task_id. Trung idempotency_key -> tra task cu, khong chay lai.
   * @param {object} input
   * @param {{trusted?: boolean}} o  trusted=false (mac dinh tu MCP): chi nhan PUBLIC_SPEC_FIELDS, cwd bat buoc (B19, B23)
   */
  async spawn(input, { trusted = true } = {}) {
    const active = this.activeTasks();
    const { depth, parent } = await this.callerDepth(active);
    if (depth >= this.maxDepth) throw new Error(`vuot do sau de quy ORCH_MAX_DEPTH=${this.maxDepth} (task cha ${parent ?? '?'}; subagent khong duoc goi tiep subagent)`);
    if (active.length >= this.maxActive) throw new Error(`dang co ${active.length} task chay >= ORCH_MAX_ACTIVE=${this.maxActive}; doi bot hoac huy task`);
    let spec = normalizeSpec(trusted ? input : pickPublicSpec(input), { requireCwd: !trusted });
    const sameCwd = active.filter((t) => t.cwd && cwdWithin(t.cwd, spec.cwd) && cwdWithin(spec.cwd, t.cwd));
    if (sameCwd.length >= this.maxActivePerCwd) throw new Error(`project ${spec.cwd} dang co ${sameCwd.length} task chay >= ORCH_MAX_ACTIVE_PER_CWD=${this.maxActivePerCwd}; doi bot hoac huy task`);
    const gate = this.hooks.pre_spawn(spec) ?? { allow: true };
    if (gate.allow === false) throw new Error(`policy tu choi: ${gate.reason ?? 'pre_spawn'}`);
    if (gate.spec) spec = gate.spec;
    if (spec.backend === 'auto') spec.backend = this.hooks.route(spec);
    const { task, created } = this.store.createTask({ ...spec, depth: depth + 1, parent_task_id: spec.parent_task_id ?? parent });
    if (created) this._launch(task.task_id, { force: true });
    return { task_id: task.task_id, backend: task.backend, created, turn: 1, status: this.store.state(task.task_id).status,
      hint: 'Khong cho. Lam viec khac; dung subagent_wait (<=50s, tra kem summary) hoac doi thong bao.' };
  }

  /** Sync-if-fast (B7e): viec ngan tra ket qua trong MOT lan goi; viec dai tra task_id. */
  async run(input, { wait_ms = 30_000, trusted = true } = {}) {
    const r = await this.spawn(input, { trusted });
    const w = await this.wait([r.task_id], { timeoutMs: Math.min(wait_ms, 45_000) });
    if (!w.timed_out) return { ...w.tasks[0], completed: true };
    return { ...r, completed: false, hint: `Chua xong sau ${Math.min(wait_ms, 45_000)}ms; tiep tuc bang subagent_wait(task_ids:["${r.task_id}"]).` };
  }

  async status(id, { heal = true } = {}) {
    if (!this.store.hasTask(id)) throw new Error(`khong co task ${id}`);
    const s = this.store.state(id);
    const pending = this.store.pendingFollowups(id);
    const needRunner = !isDone(s) || pending > 0 || !!this.store.cancelRequested(id);
    let runner = { alive: false };
    if (needRunner) runner = await probeLease(this.store.root, `task-${id}`);
    // r3.1 (F1): pipe cua tien trinh khac quyen -> khong relaunch (se lai bi chan), bao runner_failed/lease_permission ngay
    if (needRunner && runner.alive === 'foreign') {
      return { ...s, pending_followups: pending, runner_alive: false, stale: true, status: 'runner_failed', journal_status: s.status,
        error: { class: 'lease_permission', message: `pipe lease task-${id} do tien trinh khac quyen giu (${runner.code})`, log_tail: this.store.logTail(id) },
        hint: 'Pipe do tien trinh khac quyen giu (GUI elevated / user khac dung chung ORCH_HOME?). Dat ORCH_HOME rieng cho moi muc quyen.' };
    }
    const stale = needRunner && runner.alive === false;
    const base = { ...s, pending_followups: pending, runner_alive: runner.alive === true, runner_unresponsive: runner.alive === 'unresponsive', stale };
    if (stale) {
      // N3: runner khong khoi dong duoc -> bao loi co cau truc, NGUNG tu chua (subagent_resume xoa dau loi va thu lai)
      const rf = this.runnerFailure(id);
      if (rf) return { ...base, status: 'runner_failed', journal_status: s.status, error: rf, hint: 'Sua nguyen nhan (xem error.log_tail / runner.log) roi subagent_resume.' };
      if (heal && Date.now() - (this._lastLaunch.get(id) ?? 0) > 5000) this._launch(id); // B13: tu chua - an toan vi lease loai tru
    }
    return base;
  }

  /**
   * Long-poll gioi han: tra ve khi co task ket thuc (any) / tat ca (all) hoac het timeout. Task xong co kem summary (B7d).
   * min_turn (B14): khong coi la xong neu turn hien tai < min_turn (tranh tra ket qua cua luot truoc sau followup).
   */
  async wait(ids, { timeoutMs = 45_000, mode = 'any', pollMs = 250, min_turn = null, min_turns = {}, until_followup = null } = {}) {
    const deadline = Date.now() + Math.min(timeoutMs, 50_000);
    const minFor = (id) => min_turns[id] ?? min_turn ?? 1;
    // N10 (r3): until_followup = followup_id ma subagent_followup tra ve. Xong khi followup do da duoc accepted VA turn chua no
    // da ket thuc, hoac followup bi bo (cancel). Khong doan turn -> khong nham khi nhieu followup / followup gui luc dang chay.
    const fdone = (s) => {
      if (!until_followup || s.status === 'runner_failed') return true;
      const f = s.followups?.[until_followup];
      if (!f) return false;
      return !!f.dropped || (s.turn ?? 1) >= f.turn;
    };
    // r3.1 (F2/M2): turn min_turn KHONG BAO GIO toi khi followup cua no bi cancel bo (task xong, khong con followup cho,
    // co s.cancel sau lan hoan tat cuoi) -> coi la xong, kem min_turn_unreachable:true; khong de caller cho toi deadline.
    const unreachable = (s) => isDone(s) && !s.pending_followups && (!!s.cancel || s.status === 'cancelled') && (s.turn ?? 1) < minFor(s.task_id);
    const done = (s) => isDone(s) && (s.status === 'runner_failed' || unreachable(s) || ((s.turn ?? 1) >= minFor(s.task_id) && !s.pending_followups)) && fdone(s);
    let lastHeal = 0;
    for (;;) {
      const heal = Date.now() - lastHeal > 5000;
      if (heal) lastHeal = Date.now();
      const sts = await Promise.all(ids.map((id) => this.status(id, { heal })));
      const finished = sts.filter(done);
      if ((mode === 'any' && finished.length) || (mode === 'all' && finished.length === sts.length) || Date.now() >= deadline) {
        return {
          timed_out: !finished.length || (mode === 'all' && finished.length < sts.length),
          tasks: sts.map((s) => (done(s) ? { ...brief(s), ...(s.error ? { error: s.error } : {}), ...(unreachable(s) ? { min_turn_unreachable: true } : {}), ...(until_followup ? { followup: s.followups?.[until_followup] ?? null } : {}), result: this.result(s.task_id) } : brief(s))),
        };
      }
      await sleep(pollMs);
    }
  }

  /** view: summary (mac dinh, ~1-2k token) | full | events (journal tu since_seq) */
  result(id, { view = 'summary', since_seq = 0 } = {}) {
    if (view === 'events') return { task_id: id, events: this.store.events(id, since_seq).slice(-200) };
    const r = this.store.readResult(id);
    if (!r) return { task_id: id, ready: false, status: this.store.state(id).status };
    if (view === 'full') return { ready: true, ...r };
    const { task_id, backend, status, turn, summary, artifacts, changed_files, questions, format, warnings, denials, error, session, refs, outputs } = r;
    const outStr = JSON.stringify(outputs ?? {});
    return { ready: true, task_id, turn, backend, status, format, summary, outputs: outStr.length <= 2000 ? outputs : { truncated: true, ref: refs?.final_message },
      artifacts: artifacts.map((a) => ({ path: a.path, description: a.description })), changed_files, questions, warnings, denials, error, resumable: session?.resumable, refs };
  }

  async cancel(id, reason = 'user') {
    const s = this.store.state(id);
    if (TERMINAL.has(s.status) && !this.store.pendingFollowups(id)) return { task_id: id, status: s.status, note: 'da ket thuc' };
    this.store.requestCancel(id, reason);
    // N1: task da xong turn hien tai -> huy chi bo cac followup dang cho (ket qua turn da xong giu nguyen, khong ghi de)
    const note = TERMINAL.has(s.status) ? `turn ${s.turn ?? 1} da ${s.status}; huy se bo ${this.store.pendingFollowups(id)} followup dang cho (followup.dropped)` : undefined;
    const p = await probeLease(this.store.root, `task-${id}`, { msg: { poke: 'cancel' } });
    if (p.alive === false && !this.runnerFailure(id)) this._launch(id); // runner "janitor": chiem lease, thay cancel.request, ghi task.completed{cancelled}
    return { task_id: id, status: 'cancel_requested', ...(note ? { note } : {}) };
  }

  /** Gui them chi dan vao CUNG phien backend. Tra ve followup_id -> subagent_wait(until_followup). */
  async followup(id, prompt) {
    if (!this.store.hasTask(id)) throw new Error(`khong co task ${id}`);
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt bat buoc');
    const s = this.store.state(id);
    const followup_id = this.store.enqueueFollowup(id, prompt);
    const p = await probeLease(this.store.root, `task-${id}`, { msg: { poke: 'followup' } });
    if (p.alive === false && !this.runnerFailure(id)) this._launch(id);
    // turn chi la UOC LUONG (nhieu followup gop vao mot turn, hoac followup toi khi turn dang chay) -> dung followup_id.
    // r3.1 (F2): khong tra `turn` nua (uoc luong la bay khi followup bi cancel bo); chi turn_estimate de hien thi.
    return { task_id: id, status: 'followup_queued', followup_id, turn_estimate: (s.turn ?? 1) + 1,
      hint: `subagent_wait(task_ids:["${id}"], until_followup:"${followup_id}")` };
  }

  /** Tiep tuc task bi park (sau khi dang nhap lai/het quota/sua policy) hoac bi gian doan. */
  async resume(id) {
    this.store.clearRunnerFailure(id); // N3: nguoi dung da sua nguyen nhan -> cho phep launch/tu chua lai
    const s = this.store.state(id);
    if (TERMINAL.has(s.status)) return { task_id: id, status: s.status, note: 'da ket thuc; dung followup de giao them' };
    if (s.status === 'needs_attention') this.store.request(id, 'resume');
    const p = await probeLease(this.store.root, `task-${id}`, { msg: { poke: 'resume' } });
    if (p.alive === true) return { task_id: id, status: s.status, note: 'runner dang chay' };
    this._launch(id, { force: true });
    return { task_id: id, status: 'resuming' };
  }

  async list({ run_id = null, active_only = false, limit = 50 } = {}) {
    const ids = this.store.listTaskIds().slice(-limit * 4);
    const out = [];
    for (const id of ids) {
      const s = this.store.state(id);
      if (run_id && s.run_id !== run_id) continue;
      if (active_only && isDone(s)) continue;
      out.push(brief(s));
    }
    return out.slice(-limit);
  }

  /** Khi MCP server/GUI khoi dong: task chua xong ma khong co runner -> launch runner (runner tu ghi task.interrupted). */
  async reconcile({ relaunch = true } = {}) {
    const out = [];
    for (const id of this.store.listTaskIds()) {
      let s; try { s = this.store.state(id); } catch { continue; }
      const pending = this.store.pendingFollowups(id) > 0 || !!this.store.cancelRequested(id);
      if (isDone(s) && !pending) continue;
      const p = await probeLease(this.store.root, `task-${id}`);
      if (p.alive !== false) continue;
      if (relaunch) this._launch(id);
      out.push({ task_id: id, action: relaunch ? 'relaunched' : 'orphan' });
    }
    return out;
  }

  /** Thong bao chua doc cua MOT nguoi tieu thu (B6). Khong xoa cua ai. */
  async notifications(consumer = 'default', o = {}) { return this.store.readNotifications(consumer, o); }
}

function safeDepth(store, id) { try { return store.getTask(id).depth ?? 1; } catch { return 1; } }
function safeCwd(store, id) { try { return store.getTask(id).cwd ?? null; } catch { return null; } }

function brief(s) {
  return { task_id: s.task_id, title: s.title, backend: s.backend, status: s.status, turn: s.turn ?? 1, attempt: s.attempt,
    progress: s.progress, open_tools: s.open_tools ?? 0, failure: s.failure?.class ?? null, pending_followups: s.pending_followups ?? 0,
    runner_alive: s.runner_alive, cwd: s.cwd ?? null, updated_at: s.updated_at,
    ...(s.cancel ? { cancel: s.cancel } : {}) }; // r3.1 F2: followup bi cancel bo hien ngay trong brief
}
