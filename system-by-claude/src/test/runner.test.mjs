// Vong doi end-to-end voi backend gia lap (khong chay backend that). Moi test ung voi mot loi B* cua phan bien r1.
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Hub } from '../lib/hub.mjs';
import { runTaskLoop, runTask } from '../lib/runner.mjs';
import { normalizeSpec } from '../lib/schema.mjs';
import { createFakeAdapter } from '../lib/adapters/fake.mjs';
import { pidAlive } from '../lib/proc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, '..', 'bin');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orch-run-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bat bien envelope (B5) tren MOI ket qua succeeded. */
function checkInvariant(hub) {
  for (const id of hub.store.listTaskIds()) {
    const r = hub.store.readResult(id);
    if (r?.status === 'succeeded') {
      assert.equal(r.error, null, `succeeded nhung error != null (${id})`);
      assert.ok(r.summary && r.summary.trim(), `succeeded nhung summary rong (${id})`);
    }
    const seqs = hub.store.events(id).map((e) => e.seq);
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), `seq phai 1..n duy nhat (${id})`);
  }
}

/** Hub voi launcher chay runner TRONG tien trinh test (nhanh, debug duoc). delayMs mo phong runner khoi dong cham. */
function makeHub({ runnerHooks, delayMs = 0, noop = false } = {}) {
  const runs = [];
  const adapters = { fake: createFakeAdapter(), fake2: createFakeAdapter({ id: 'fake2', scenario: 'ok' }) };
  const hub = new Hub({
    root: tmp(),
    launcher: (id) => {
      if (noop) return;
      runs.push((async () => { if (delayMs) await sleep(delayMs); return runTaskLoop(hub.store, id, { adapters, pollMs: 50, hooks: runnerHooks }); })());
    },
  });
  hub.drain = async () => { while (runs.length) await runs.shift(); checkInvariant(hub); };
  hub.adapters = adapters;
  return hub;
}
const spec = (scenario, extra = {}) => ({ prompt: 'lam viec X', backend: 'fake', cwd: process.cwd(), backend_options: { fake: { scenario } }, ...extra });
const count = (hub, id, type) => hub.store.events(id).filter((e) => e.type === type).length;

test('thanh cong: spawn khong chan, ket qua dung hop dong, thong bao co run_id', async () => {
  const hub = makeHub();
  const t0 = Date.now();
  const r = await hub.spawn(spec('ok', { run_id: 'R1', title: 'viec 1' }));
  assert.ok(Date.now() - t0 < 500, 'spawn phai khong chan');
  assert.equal(r.created, true);
  await hub.drain();
  const res = hub.result(r.task_id);
  assert.equal(res.status, 'succeeded');
  assert.equal(res.format, 'contract');
  assert.equal(res.turn, 1);
  assert.match(res.summary, /fake ok/);
  const n = await hub.notifications('gui-A');
  assert.equal(n.length, 1);
  assert.equal(n[0].run_id, 'R1');
  assert.equal((await hub.notifications("gui-A")).length, 0, 'cursor rieng: da doc thi khong lap');
  assert.equal((await hub.notifications("gui-B")).length, 1, 'nguoi tieu thu khac van thay (B6)');
});

test('output sai dinh dang -> repair turn trong cung phien', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('bad_output_once'));
  await hub.drain();
  const res = hub.result(task_id, { view: 'full' });
  assert.equal(res.status, 'succeeded');
  assert.equal(res.format, 'contract');
  assert.equal(count(hub, task_id, 'output.repair_requested'), 1);
});

test('B5: output sai mai -> degraded = succeeded + error null + warnings unverified_format', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('bad_output_always'));
  await hub.drain();
  const res = hub.result(task_id, { view: 'full' });
  assert.equal(res.status, 'succeeded');
  assert.equal(res.format, 'degraded');
  assert.equal(res.error, null);
  assert.deepEqual(res.warnings, ['unverified_format']);
  assert.match(res.summary, /a\.js/);
});

test('B5: thoat 0 khong co tin nhan cuoi -> no_output, thu lai 1 lan roi failed (khong bao gio succeeded rong)', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('silent'));
  await hub.drain();
  const res = hub.result(task_id, { view: 'full' });
  assert.equal(res.status, 'failed');
  assert.equal(res.error.class, 'no_output');
  assert.equal(count(hub, task_id, 'attempt.started'), 2);
  const h2 = makeHub();
  const b = await h2.spawn(spec('silent_once'));
  await h2.drain();
  assert.equal(h2.result(b.task_id).status, 'succeeded');
});

test('crash lan dau -> resume phien -> thanh cong', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('crash_once'));
  await hub.drain();
  const res = hub.result(task_id, { view: 'full' });
  assert.equal(res.status, 'succeeded');
  assert.equal(res.attempts, 2);
  const types = hub.store.events(task_id).map((e) => e.type);
  assert.ok(types.includes('attempt.failed') && types.includes('retry.scheduled'));
});

test('crash lien tuc -> resume 1 lan, roi fresh, roi failed (B20: khong resume vo han)', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('crash_always'));
  await hub.drain();
  const res = hub.result(task_id, { view: 'full' });
  assert.equal(res.status, 'failed');
  assert.equal(res.error.class, 'crash');
  const modes = hub.store.events(task_id).filter((e) => e.type === 'attempt.started').map((e) => e.data.mode);
  assert.deepEqual(modes, ['fresh', 'resume', 'fresh']);
});

test('rate limit co retry-after ngan -> cho roi thu lai', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('rate_limit_once'));
  await hub.drain();
  assert.equal(hub.store.events(task_id).find((e) => e.type === 'attempt.failed').data.class, 'rate_limited');
  assert.equal(hub.result(task_id).status, 'succeeded');
});

test('auth khong co failover -> park needs_attention + thong bao; resume sau khi sua -> chay lai', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('auth'));
  await hub.drain();
  assert.equal((await hub.status(task_id)).status, 'needs_attention');
  assert.equal(count(hub, task_id, 'attempt.started'), 1);
  assert.equal((await hub.notifications("c")).at(-1).status, 'needs_attention');
  // runner khoi dong lai ma KHONG co resume.request -> khong chay lai (khong retry mu)
  await runTask(hub.store, task_id, { adapters: hub.adapters, pollMs: 50 });
  assert.equal(count(hub, task_id, 'attempt.started'), 1);
  const r = await hub.resume(task_id);
  assert.equal(r.status, 'resuming');
  await hub.drain();
  assert.equal(count(hub, task_id, 'task.resumed'), 1);
  assert.equal(count(hub, task_id, 'attempt.started'), 2);
});

test('auth co failover -> chuyen backend khac va xong', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('auth', { failover: ['fake2'] }));
  await hub.drain();
  const res = hub.result(task_id, { view: 'full' });
  assert.equal(res.status, 'succeeded');
  assert.equal(res.backend, 'fake2');
  assert.deepEqual(res.failovers.map((f) => f.to), ['fake2']);
});

test('treo (idle timeout) -> kill cay tien trinh -> resume', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('hang', { limits: { idle_timeout_ms: 600 } }));
  await hub.drain();
  assert.equal(hub.store.events(task_id).find((e) => e.type === 'attempt.failed').data.class, 'hang');
  assert.equal(hub.result(task_id).status, 'succeeded');
});

test('B15: tool chay lau hon idle_timeout nhung co tool dang mo -> KHONG bi coi la treo', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('long_tool', { limits: { idle_timeout_ms: 600, tool_idle_timeout_ms: 10_000 } }));
  await hub.drain();
  assert.equal(hub.result(task_id).status, 'succeeded');
  assert.equal(count(hub, task_id, 'attempt.failed'), 0);
});

test('huy giua chung (poke qua pipe)', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('slow'));
  await sleep(400);
  const t0 = Date.now();
  await hub.cancel(task_id);
  await hub.drain();
  assert.ok(Date.now() - t0 < 1500, 'huy co hieu luc nhanh');
  assert.equal((await hub.status(task_id)).status, 'cancelled');
});

test('B4: huy ngay sau spawn khi runner chua kip chay -> cancelled, 0 attempt, mot writer, seq duy nhat', async () => {
  const hub = makeHub({ delayMs: 300 });
  const { task_id } = await hub.spawn(spec('slow'));
  await hub.cancel(task_id); // runner chua co -> hub launch "janitor" (2 runner cung dua; lease chon 1)
  await hub.drain();
  assert.equal(hub.store.state(task_id).status, 'cancelled');
  assert.equal(count(hub, task_id, 'attempt.started'), 0);
  assert.equal(count(hub, task_id, 'task.completed'), 1);
  assert.equal(hub.result(task_id).error.class, 'cancelled');
});

test('B4: hub KHONG BAO GIO ghi journal (spawn/followup/cancel/resume khi khong co runner)', async () => {
  const hub = makeHub({ noop: true });
  const { task_id } = await hub.spawn(spec('ok'));
  await hub.followup(task_id, 'them');
  await hub.resume(task_id);
  await hub.cancel(task_id);
  assert.equal(fs.existsSync(hub.store.file(task_id, 'events.jsonl')), false);
  assert.ok(fs.existsSync(path.join(hub.store.controlDir(task_id), 'cancel.request')));
});

test('agent tu bao that bai -> failed, khong retry', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('agent_failed'));
  await hub.drain();
  const res = hub.result(task_id);
  assert.equal(res.status, 'failed');
  assert.equal(res.error.class, 'agent_failed');
  assert.equal(count(hub, task_id, 'attempt.started'), 1);
});

test('B14: followup cung phien, turn=2; wait(min_turn) khong tra ket qua luot cu (runner khoi dong cham)', async () => {
  const hub = makeHub({ delayMs: 300 });
  const { task_id } = await hub.spawn(spec('echo_prompt'));
  await hub.drain();
  assert.equal(hub.result(task_id, { view: 'full' }).outputs.resumed, false);
  const f = await hub.followup(task_id, 'Them: viet test');
  assert.equal(f.turn_estimate, 2);
  const w = await hub.wait([task_id], { timeoutMs: 20_000, pollMs: 30, min_turn: f.turn_estimate });
  assert.equal(w.timed_out, false);
  assert.equal(w.tasks[0].turn, 2);
  assert.equal(w.tasks[0].result.turn, 2);
  assert.equal(w.tasks[0].result.outputs.resumed, true);
  // khong co min_turn: pending_followups > 0 cung chan viec tra ket qua cu
  await hub.followup(task_id, 'Them nua');
  const w2 = await hub.wait([task_id], { timeoutMs: 20_000, pollMs: 30 });
  assert.equal(w2.tasks[0].result.turn, 3);
  await hub.drain();
});

test('idempotency qua hub: spawn lai cung key khong chay lai', async () => {
  const hub = makeHub();
  const a = await hub.spawn(spec('ok', { idempotency_key: 'job-1' }));
  const b = await hub.spawn(spec('ok', { idempotency_key: 'job-1' }));
  await hub.drain();
  assert.equal(a.task_id, b.task_id);
  assert.equal(b.created, false);
});

/** Tao task "runner da chet giua chung": co attempt.started voi pid backend that dang song. */
function seedInterrupted(hub, scenario, { orphanPid = null, spawnedAt = Date.now(), interruptions = 0 } = {}) {
  const { task } = hub.store.createTask({ ...normalizeSpec(spec(scenario)), depth: 1 });
  const j = hub.store.openJournal(task.task_id);
  j.append('task.created', { backend: 'fake' });
  j.append('attempt.started', { backend: 'fake', pid: orphanPid, spawned_at: spawnedAt, mode: 'fresh' }, 1);
  j.append('backend.session', { session_id: 'sess-old' }, 1);
  for (let i = 0; i < interruptions; i++) j.append('task.interrupted', { reason: 'seed' });
  return task.task_id;
}

test('B10/B13: tiep quan - kill backend mo coi da xac thuc, ghi task.interrupted, resume phien cu', async () => {
  const hub = makeHub();
  const orphan = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => orphan.once('spawn', r));
  const id = seedInterrupted(hub, 'echo_prompt', { orphanPid: orphan.pid });
  const st = await hub.status(id, { heal: false });
  assert.equal(st.stale, true);
  const rec = await hub.reconcile();
  assert.deepEqual(rec.map((x) => x.task_id), [id]);
  await hub.drain();
  const res = hub.result(id, { view: 'full' });
  assert.equal(res.status, 'succeeded');
  assert.equal(res.outputs.resumed, true);
  const intr = hub.store.events(id).find((e) => e.type === 'task.interrupted');
  assert.equal(intr.data.orphan.killed, true);
  await sleep(300);
  assert.equal(pidAlive(orphan.pid), false, 'backend mo coi phai bi kill');
});

test('B10: pid trong journal da bi tai su dung (thoi diem tao khong khop) -> KHONG kill', async () => {
  const hub = makeHub();
  const other = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => other.once('spawn', r));
  try {
    const id = seedInterrupted(hub, 'ok', { orphanPid: other.pid, spawnedAt: Date.now() - 3_600_000 });
    await hub.reconcile();
    await hub.drain();
    assert.equal(hub.store.events(id).find((e) => e.type === 'task.interrupted').data.orphan.reason, 'pid da bi tai su dung');
    assert.equal(pidAlive(other.pid), true);
  } finally { other.kill(); }
});

test('B12: poison - bi gian doan qua max_interruptions -> park lop poison, khong lap vo han', async () => {
  const hub = makeHub();
  const id = seedInterrupted(hub, 'ok', { interruptions: 3 });
  await hub.reconcile();
  await hub.drain();
  const s = hub.store.state(id);
  assert.equal(s.status, 'needs_attention');
  assert.equal(s.failure.class, 'poison');
  assert.equal(count(hub, id, 'attempt.started'), 1, 'khong chay them attempt');
});

test('B13: status tu chua khi task khong co runner (launcher lan dau that bai)', async () => {
  let fail = true;
  const runs = [];
  const adapters = { fake: createFakeAdapter() };
  const hub = new Hub({ root: tmp(), launcher: (id) => { if (fail) { fail = false; return; } runs.push(runTaskLoop(hub.store, id, { adapters, pollMs: 50 })); } });
  const { task_id } = await hub.spawn(spec('ok'));
  hub._lastLaunch.clear(); // bo throttle 5s cho test
  const cdir = hub.store.controlDir(task_id); // r3.1 M5: throttle theo store (file launch-*) -> xoa dau launch
  for (const f of fs.readdirSync(cdir).filter((x) => x.startsWith('launch-'))) fs.unlinkSync(path.join(cdir, f));
  const st = await hub.status(task_id);
  assert.equal(st.stale, true);
  while (runs.length) await runs.shift();
  assert.equal(hub.store.state(task_id).status, 'succeeded');
});

test('B18: access=write ma policy khong cap quyen -> park config, KHONG chay backend; co grants -> chay', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('ok', { access: 'write' }));
  await hub.drain();
  const s = hub.store.state(task_id);
  assert.equal(s.status, 'needs_attention');
  assert.equal(s.failure.class, 'config');
  assert.equal(count(hub, task_id, 'attempt.started'), 0);
  const h2 = makeHub({ runnerHooks: { pre_attempt: () => ({ grants: { write: true } }) } });
  const b = await h2.spawn(spec('ok', { access: 'write', cwd: tmp() }));
  await h2.drain();
  assert.equal(h2.result(b.task_id).status, 'succeeded');
});

test('B18: permission_denials cua backend -> denials + warning permission_denied', async () => {
  const hub = makeHub();
  const { task_id } = await hub.spawn(spec('denied'));
  await hub.drain();
  const r = hub.result(task_id);
  assert.equal(r.status, 'succeeded');
  assert.equal(r.denials[0].tool, 'Write');
  assert.ok(r.warnings.includes('permission_denied'));
});

test('B9: goi tu ben trong worker (ORCH_DEPTH>=max) -> tu choi; MAX_ACTIVE gioi han so task', async () => {
  const hub = makeHub({ noop: true });
  process.env.ORCH_DEPTH = '2';
  try { await assert.rejects(hub.spawn(spec('ok')), /ORCH_MAX_DEPTH/); } finally { delete process.env.ORCH_DEPTH; }
  hub.maxActive = 2;
  await hub.spawn(spec('ok'));
  await hub.spawn(spec('ok'));
  await assert.rejects(hub.spawn(spec('ok')), /ORCH_MAX_ACTIVE/);
  // to tien (khong phu thuoc env): mot backend dang chay la cha cua tien trinh nay
  const h2 = makeHub({ noop: true });
  const { task_id } = await h2.spawn(spec('ok'));
  const j = h2.store.openJournal(task_id);
  j.append('task.created', {});
  j.append('attempt.started', { backend: 'fake', pid: 4242, spawned_at: Date.now() }, 1);
  h2.ancestryFn = () => [111, 4242, 1];
  h2.maxDepth = 1;
  process.env.ORCH_ANCESTRY_CHECK = '1';
  try { await assert.rejects(h2.spawn(spec('ok')), new RegExp(task_id)); } finally { process.env.ORCH_ANCESTRY_CHECK = '0'; }
});

test('wait tra ve som kem summary khi co task xong; subagent_run sync-if-fast', async () => {
  const hub = makeHub();
  const a = await hub.spawn(spec('ok'));
  const w = await hub.wait([a.task_id], { timeoutMs: 20_000, pollMs: 50 });
  assert.equal(w.timed_out, false);
  assert.match(w.tasks[0].result.summary, /fake ok/);
  const r = await hub.run(spec('ok'), { wait_ms: 20_000 });
  assert.equal(r.completed, true);
  assert.equal(r.status, 'succeeded');
  await hub.drain();
});

test('runner tach roi that (detached) qua launcher mac dinh', async () => {
  const hub = new Hub({ root: tmp() });
  const { task_id } = await hub.spawn(spec('slow'));
  const w = await hub.wait([task_id], { timeoutMs: 30_000 });
  assert.equal(w.timed_out, false, JSON.stringify(w));
  assert.equal(w.tasks[0].result.status, 'succeeded');
});

test('B3/B4 da tien trinh: 50 task x 2 runner-main dong thoi -> dung 1 attempt moi task, seq duy nhat', async () => {
  const hub = makeHub({ noop: true });
  hub.maxActive = 1000; hub.maxActivePerCwd = 1000;
  const ids = [];
  for (let i = 0; i < 50; i++) ids.push((await hub.spawn(spec('ok'))).task_id);
  const runOne = (id) => new Promise((r) => {
    const c = spawn(process.execPath, [path.join(BIN, 'runner-main.mjs'), '--root', hub.store.root, id], { stdio: 'ignore', windowsHide: true });
    c.on('close', r);
  });
  for (let b = 0; b < ids.length; b += 10) {
    await Promise.all(ids.slice(b, b + 10).flatMap((id) => [runOne(id), runOne(id)]));
  }
  for (const id of ids) {
    assert.equal(count(hub, id, 'attempt.started'), 1, `task ${id}`);
    assert.equal(count(hub, id, 'task.created'), 1);
    assert.equal(hub.store.state(id).status, 'succeeded');
  }
  checkInvariant(hub);
});

// ---------------- MCP stdio ----------------
function mcpClient(root) {
  const child = spawn(process.execPath, [path.join(BIN, 'mcp-server.mjs')], { env: { ...process.env, ORCH_HOME: root }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      pending.get(m.id)?.(m); pending.delete(m.id);
    }
  });
  let nid = 0;
  const rpc = (method, params) => new Promise((res) => { const id = ++nid; pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { rpc, close: () => child.kill() };
}

test('MCP stdio (B8, B19, B23): thuong luong version, discover -32601, _meta -32602, run/spawn/wait, loc truong', async () => {
  const root = tmp();
  const { rpc, close } = mcpClient(root);
  try {
    const disc = await rpc('server/discover', {});
    assert.equal(disc.error.code, -32601);
    const init = await rpc('initialize', { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.capabilities.tasks, undefined, 'khong quang ba MCP Tasks');
    const old = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
    assert.equal(old.result.protocolVersion, '2025-03-26');
    const meta = await rpc('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } });
    assert.equal(meta.error.code, -32602);
    assert.ok(meta.error.data.supported.includes('2025-06-18'));
    const list = await rpc('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    for (const n of ['subagent_spawn', 'subagent_run', 'subagent_wait', 'subagent_doctor']) assert.ok(names.includes(n), n);
    // thieu cwd -> isError (B23)
    const noCwd = await rpc('tools/call', { name: 'subagent_spawn', arguments: { prompt: 'x', backend: 'fake' } });
    assert.equal(noCwd.result.isError, true);
    assert.match(noCwd.result.structuredContent.error, /cwd/);
    // backend_options/limits tu MCP bi bo qua (B19): scenario 'auth' khong co hieu luc
    const run = await rpc('tools/call', { name: 'subagent_run', arguments: { prompt: 'x', backend: 'fake', cwd: process.cwd(), wait_ms: 30_000, backend_options: { fake: { scenario: 'auth' } }, limits: { max_attempts: 99 } } });
    assert.equal(run.result.isError, false, JSON.stringify(run.result));
    assert.equal(run.result.structuredContent.completed, true);
    assert.equal(run.result.structuredContent.status, 'succeeded');
    const tid = run.result.structuredContent.task_id;
    const task = JSON.parse(fs.readFileSync(path.join(root, 'tasks', tid, 'task.json'), 'utf8'));
    assert.deepEqual(task.backend_options ?? {}, {});
    assert.equal(task.limits.max_attempts, 3);
    const sp = await rpc('tools/call', { name: 'subagent_spawn', arguments: { prompt: 'y', backend: 'fake', cwd: process.cwd() } });
    const w = await rpc('tools/call', { name: 'subagent_wait', arguments: { task_ids: [sp.result.structuredContent.task_id], timeout_ms: 30000 } });
    assert.equal(w.result.structuredContent.tasks[0].status, 'succeeded');
    assert.match(w.result.structuredContent.tasks[0].result.summary, /fake/);
    const bad = await rpc('tools/call', { name: 'subagent_spawn', arguments: {} });
    assert.equal(bad.result.isError, true);
  } finally {
    close();
  }
});

// ---------------- CLI inbox (hook) ----------------
function runCli(args, { input = '', env = {} } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(BIN, 'orch.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
    c.stdin.end(input);
  });
}

test('B6: orch inbox --hook lay consumer tu session_id/conversationId; im lang trong worker; luon exit 0', async () => {
  const hub = makeHub({ noop: true });
  hub.store.notify('t_demo', { status: 'succeeded', turn: 1, summary_head: 'xong viec demo', run_id: 'R' });
  const env = { ORCH_HOME: hub.store.root };
  const worker = await runCli(['inbox', '--hook', '--root', hub.store.root], { input: '{"session_id":"s1"}', env: { ...env, ORCH_DEPTH: '1' } });
  assert.equal(worker.code, 0);
  assert.equal(worker.out, '', 'trong worker khong in (khong nuot thong bao cua orchestrator)');
  const a = await runCli(['inbox', '--hook', '--root', hub.store.root], { input: '{"session_id":"s1","hook_event_name":"UserPromptSubmit"}', env });
  assert.match(a.out, /t_demo succeeded: xong viec demo/);
  const again = await runCli(['inbox', '--hook', '--root', hub.store.root], { input: '{"session_id":"s1"}', env });
  assert.equal(again.out, '', 'cung phien khong lap lai');
  const agy = await runCli(['inbox', '--hook', '--root', hub.store.root], { input: '{"conversationId":"c9"}', env });
  assert.match(agy.out, /t_demo/, 'phien khac (agy conversationId) van thay');
  const fileRoot = path.join(hub.store.root, 'la-file');
  fs.writeFileSync(fileRoot, 'x');
  const broken = await runCli(['inbox', '--hook', '--root', path.join(fileRoot, 'sub')], { input: 'not json', env });
  assert.equal(broken.code, 0, 'hook agy fail-closed -> loi cung phai exit 0');
});
