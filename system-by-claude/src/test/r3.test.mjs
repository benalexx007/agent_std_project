// Test vong 3: moi test ung voi mot muc N*/D*/E* cua docs/04-critique-r2.md (khong chay backend that).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Hub, detachedLauncher } from '../lib/hub.mjs';
import { runTaskLoop, runTask } from '../lib/runner.mjs';
import { TaskStore, defaultRoot } from '../lib/store.mjs';
import { normalizeSpec, isStrictable, strictFinalSchema } from '../lib/schema.mjs';
import { createFakeAdapter } from '../lib/adapters/fake.mjs';
import { pidAlive, procCreationTime, planSpawn, killTree } from '../lib/proc.mjs';
import { listenErrorAction } from '../lib/lease.mjs';
import { ensureJobrun, quoteArg } from '../lib/jobrun.mjs';
import { jobVerdict, envCheck } from '../lib/doctor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, '..', 'bin');
const tmp = (p = 'orch-r3-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWin = process.platform === 'win32';
const JOBROOT = tmp('orch-r3-jobrun ');
const JR = ensureJobrun(JOBROOT);

function makeHub({ noop = false, jobrun = false, opts = {} } = {}) {
  const runs = [];
  const adapters = { fake: createFakeAdapter() };
  const hub = new Hub({
    root: tmp(),
    launcher: (id) => { if (!noop) runs.push(runTaskLoop(hub.store, id, { adapters, pollMs: 50, hooks: { on_notify: () => {} }, jobrunExe: jobrun ? JR.exe : null, ...opts })); },
  });
  hub.drain = async () => { while (runs.length) await runs.shift(); };
  hub.opts = { adapters, pollMs: 50, hooks: { on_notify: () => {} }, jobrunExe: jobrun ? JR.exe : null, ...opts };
  hub.maxActive = 1000;
  hub.maxActivePerCwd = 1000;
  return hub;
}
const spec = (scenario, extra = {}) => ({ prompt: 'lam viec X', backend: 'fake', cwd: process.cwd(), backend_options: { fake: { scenario } }, ...extra });
const types = (hub, id) => hub.store.events(id).map((e) => e.type);
const count = (hub, id, t) => types(hub, id).filter((x) => x === t).length;

// ---------------- E1 / N1 ----------------
test('E1/N1 Q3-A: task da xong -> followup -> cancel: followup bi bo, turn khong tang, 1 attempt; wait(until_followup) thay dropped', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('ok'));
  await runTaskLoop(hub.store, id, hub.opts);
  const f = await hub.followup(id, 'lam them X');
  const c = await hub.cancel(id);
  assert.equal(c.status, 'cancel_requested');
  assert.match(c.note, /followup/);
  await runTaskLoop(hub.store, id, hub.opts);
  const s = hub.store.state(id);
  assert.equal(s.turn, 1);
  assert.equal(count(hub, id, 'attempt.started'), 1);
  assert.equal(count(hub, id, 'followup.dropped'), 1);
  assert.equal(count(hub, id, 'followup.accepted'), 0);
  assert.equal(hub.store.pendingFollowups(id), 0);
  assert.ok(fs.readdirSync(path.join(hub.store.controlDir(id), 'dropped')).length === 1, 'followup bi bo nam trong control/dropped/');
  const w = await hub.wait([id], { until_followup: f.followup_id, timeoutMs: 2000 });
  assert.equal(w.timed_out, false);
  assert.equal(w.tasks[0].followup.dropped, true);
});

test('E1/N1 Q3-B: task dang chay -> followup -> cancel: cancelled, turn 1, 1 attempt.started, followup.dropped', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('slow'));
  const p = runTaskLoop(hub.store, id, hub.opts);
  await sleep(500);
  await hub.followup(id, 'lam them Y');
  await hub.cancel(id);
  await p;
  const s = hub.store.state(id);
  assert.equal(s.status, 'cancelled');
  assert.equal(s.turn, 1);
  assert.equal(count(hub, id, 'attempt.started'), 1);
  assert.equal(count(hub, id, 'followup.dropped'), 1);
});

test('N1: followup gui SAU cancel la viec moi -> van chay turn moi', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('slow'));
  const p = runTaskLoop(hub.store, id, hub.opts);
  await sleep(400);
  await hub.cancel(id);
  await sleep(20);
  const f = await hub.followup(id, 'viec moi sau huy');
  await p;
  await runTaskLoop(hub.store, id, hub.opts);
  const s = hub.store.state(id);
  assert.equal(s.followups[f.followup_id]?.turn, 2, 'followup sau cancel duoc accepted o turn 2');
  assert.equal(s.status, 'succeeded');
});

// ---------------- E2 / N2 ----------------
test('E2/N2 (a): 15 thong bao, max=10 -> 10 cu nhat roi 5 con lai, 0 mat 0 lap', async () => {
  const st = new TaskStore(tmp());
  await st.readNotifications('gui');
  for (let i = 0; i < 15; i++) st.notify(`t${String(i).padStart(2, '0')}`, {});
  const r1 = await st.readNotifications('gui');
  const r2 = await st.readNotifications('gui');
  const r3 = await st.readNotifications('gui');
  assert.equal(r1.length, 10);
  assert.equal(r1[0].task_id, 't00', 'cu nhat truoc');
  assert.equal(r2.length, 5);
  assert.equal(r3.length, 0);
  assert.equal(new Set([...r1, ...r2].map((x) => x.task_id)).size, 15);
});

test('E2/N2 (b): ten co timestamp NHO hon cursor hien ra muon (rename cham) -> van duoc doc, khong lap', async () => {
  const root = tmp(); const st = new TaskStore(root);
  await st.readNotifications('gui');
  const t = Date.now();
  const nd = path.join(root, 'notifications');
  fs.writeFileSync(path.join(nd, `${String(t + 5).padStart(15, '0')}-B-aaaaaa.json`), JSON.stringify({ task_id: 'B' }));
  assert.deepEqual((await st.readNotifications('gui')).map((x) => x.task_id), ['B']);
  fs.writeFileSync(path.join(nd, `${String(t).padStart(15, '0')}-A-bbbbbb.json`), JSON.stringify({ task_id: 'A' }));
  assert.deepEqual((await st.readNotifications('gui')).map((x) => x.task_id), ['A']);
  assert.deepEqual(await st.readNotifications('gui'), []);
});

const NOTIFY_HELPER = path.join(here, 'fixtures', 'notify-helper.mjs');
function runHelper(args) {
  return new Promise((resolve) => {
    let o = '';
    const c = spawn(process.execPath, [NOTIFY_HELPER, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    c.stdout.on('data', (d) => { o += d; });
    c.on('close', () => resolve(o));
  });
}
test('E2/N2 (c)+(d) da tien trinh, 3 lan: 3 writer x 300 + reader lien tuc; 2 reader cung consumer -> 0 mat, 0 lap', async () => {
  for (let round = 0; round < 3; round++) {
    const root = tmp(); await new TaskStore(root).readNotifications('c1');
    const rd = runHelper(['reader', root, '5000']);
    await sleep(300);
    await Promise.all(['W1', 'W2', 'W3'].map((tag) => runHelper(['writer', root, tag, '300'])));
    const seen = JSON.parse(await rd);
    assert.equal(new Set(seen).size, 900, `vong ${round}: mat ${900 - new Set(seen).size}`);
    assert.equal(seen.length, 900, `vong ${round}: lap ${seen.length - new Set(seen).size}`);
  }
  const root = tmp(); const st = new TaskStore(root); await st.readNotifications('c1');
  for (let i = 0; i < 200; i++) st.notify(`d${i}`, {});
  const outs = await Promise.all([0, 1].map(() => runHelper(['reader', root, '300'])));
  const all = outs.flatMap((o) => JSON.parse(o));
  assert.equal(all.length, 200, 'tong = 200 (khong lap)');
  assert.equal(new Set(all).size, 200);
});

// ---------------- E3 / N3 + N7 ----------------
test('E3/N3 Q9: runner khong khoi dong duoc (ORCH_POLICY hong) -> runner_failed <= 20s, co log_tail; resume xoa dau loi', async () => {
  const root = tmp();
  const prev = process.env.ORCH_POLICY;
  process.env.ORCH_POLICY = path.join(root, 'khong-ton-tai.mjs');
  try {
    let launches = 0;
    const real = detachedLauncher(root);
    const hub = new Hub({ root, launcher: (id) => { launches++; return real(id); } });
    const { task_id: id } = await hub.spawn(spec('ok', { cwd: root }));
    const t0 = Date.now();
    const w = await hub.wait([id], { timeoutMs: 20_000 });
    assert.equal(w.timed_out, false);
    assert.equal(w.tasks[0].status, 'runner_failed');
    assert.ok(Date.now() - t0 <= 20_000);
    assert.match(w.tasks[0].error.message, /ERR_MODULE_NOT_FOUND|Cannot find module/);
    assert.ok(w.tasks[0].error.log_tail.length > 0);
    assert.ok(launches <= 2, `khong relaunch vo han (launch=${launches})`);
    // khong tu chua nua
    const n = launches; await hub.status(id); await hub.status(id);
    assert.equal(launches, n);
    // sua nguyen nhan + resume -> chay duoc
    process.env.ORCH_POLICY = prev ?? '';
    if (!prev) delete process.env.ORCH_POLICY;
    const hub2 = new Hub({ root, launcher: detachedLauncher(root) });
    await hub2.resume(id);
    const w2 = await hub2.wait([id], { timeoutMs: 20_000 });
    assert.equal(w2.tasks[0].status, 'succeeded');
  } finally {
    if (prev === undefined) delete process.env.ORCH_POLICY; else process.env.ORCH_POLICY = prev;
  }
});

test('E3/N3 (r3.1 M5: launch cu nhat >= 15s): >= 3 launch trong 60s ma khong co runner.started -> runner_failed (khong can runner ghi gi)', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('ok'));
  const now = Date.now();
  for (const dt of [20_000, 12_000, 6_000]) fs.writeFileSync(path.join(hub.store.controlDir(id), `launch-${now - dt}-aa.json`), '{}');
  const s = await hub.status(id);
  assert.equal(s.status, 'runner_failed');
  assert.match(s.error.message, /launch/);
});

test('E3/N7: EACCES khi listen pipe -> loi lease_permission (khong phai "dang co nguoi giu")', () => {
  assert.equal(listenErrorAction({ code: 'EADDRINUSE' }), 'held');
  assert.throws(() => listenErrorAction({ code: 'EACCES' }, 'x'), (e) => e.code === 'lease_permission');
  assert.throws(() => listenErrorAction({ code: 'EINVAL' }), (e) => e.code === 'EINVAL');
});

test('E3: orch wait --until-done co deadline (khong treo vo han)', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('ok'));
  // giu lease de status khong coi la stale/tu chua va khong runner_failed
  const { acquireLease } = await import('../lib/lease.mjs');
  const l = await acquireLease(hub.store.root, `task-${id}`);
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    let out = '';
    const c = spawn(process.execPath, [path.join(BIN, 'orch.mjs'), 'wait', id, '--until-done', '--timeout', '500', '--deadline', '1500', '--root', hub.store.root], { stdio: ['ignore', 'pipe', 'inherit'] });
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(JSON.parse(out)));
  });
  await l.release();
  assert.equal(r.deadline_exceeded, true);
  assert.ok(Date.now() - t0 < 10_000);
});

// ---------------- E4 / N4 ----------------
test('E4/N4 Q8b: waiting_retry, attempt da thoat (attempt.exited), pid bi tai su dung KHOP thoi diem tao -> KHONG kill', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('ok'));
  const victim = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => victim.once('spawn', r));
  const ct = procCreationTime(victim.pid);
  const j = hub.store.openJournal(id);
  j.append('task.created', { backend: 'fake' });
  j.append('attempt.started', { backend: 'fake', pid: victim.pid, spawned_at: ct, mode: 'fresh' }, 1); // khop tuyet doi
  j.append('attempt.exited', { code: 1, pid: victim.pid }, 1);
  j.append('attempt.failed', { class: 'transient', message: '503', retriable: true }, 1);
  j.append('retry.scheduled', { at: new Date(Date.now() + 30000).toISOString(), delay_ms: 30000, mode: 'retry' }, 1);
  await runTask(hub.store, id, hub.opts);
  const intr = hub.store.events(id).find((e) => e.type === 'task.interrupted');
  assert.equal(intr.data.orphan.killed, false);
  assert.match(intr.data.orphan.reason, /attempt\.exited/);
  assert.equal(pidAlive(victim.pid), true, 'tien trinh vo can khong bi kill');
  victim.kill();
});

test('E4/N4: moi attempt ghi attempt.exited{code} ngay khi backend thoat', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('crash_once'));
  await runTaskLoop(hub.store, id, hub.opts);
  const ex = hub.store.events(id).filter((e) => e.type === 'attempt.exited');
  assert.deepEqual(ex.map((e) => e.data.code), [3, 0]);
  assert.equal(hub.store.state(id).backend_pid, null);
});

// ---------------- E5 / N5 (D4) ----------------
test('E5/N5: jobrun giu nguyen dong lenh, stdin/stdout/stderr va exit code', { skip: !isWin || !JR.exe }, async () => {
  const { spawnInvocation } = await import('../lib/proc.mjs');
  const args = ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.stringify([process.argv.slice(1),s]));console.error("E");process.exit(7)})',
    'a b', 'q"x', 'tail\\', 'x\\"y', '', '{"a":"b c"}', '%PATH%', 'a&b|c'];
  const c = spawnInvocation({ command: process.execPath, args, stdin: '', cwd: process.cwd(), env: {}, jobrunExe: JR.exe });
  assert.match(c.via, /^jobrun\+/);
  let out = ''; let err = '';
  c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
  c.stdin.end('xin chao\nthe gioi');
  const code = await new Promise((r) => c.on('close', r));
  assert.equal(code, 7);
  assert.deepEqual(JSON.parse(out), [args.slice(2), 'xin chao\nthe gioi']);
  assert.equal(err.trim(), 'E');
  assert.equal(quoteArg(''), '""');
});

async function waitFile(f, ms = 10_000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fs.existsSync(f) && fs.readFileSync(f, 'utf8')) return fs.readFileSync(f, 'utf8'); await sleep(100); } return null; }

test('E5/N5 Q10: cancel task co "chau" (start /b) -> chau CHET (job KILL_ON_JOB_CLOSE cua jobrun)', { skip: !isWin || !JR.exe }, async () => {
  const hub = makeHub({ noop: true, jobrun: true });
  const { task_id: id } = await hub.spawn(spec('grandchild'));
  const p = runTaskLoop(hub.store, id, hub.opts);
  const gpid = Number(await waitFile(path.join(hub.store.taskDir(id), 'grandchild.pid')));
  assert.ok(gpid > 0 && pidAlive(gpid), 'chau dang chay');
  await hub.cancel(id);
  await p;
  await sleep(500);
  assert.equal(hub.store.state(id).status, 'cancelled');
  assert.equal(pidAlive(gpid), false, 'chau phai chet cung job');
});

test('E5/N5: runner-main bi kill cung (TerminateProcess, khong /T) -> jobrun thay cha chet -> backend + chau chet', { skip: !isWin || !JR.exe }, async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('grandchild'));
  const r = spawn(process.execPath, [path.join(BIN, 'runner-main.mjs'), '--root', hub.store.root, id], { stdio: 'ignore', detached: true, windowsHide: true, env: { ...process.env, ORCH_HOME: hub.store.root } });
  const gpid = Number(await waitFile(path.join(hub.store.taskDir(id), 'grandchild.pid'), 30_000));
  assert.ok(gpid > 0 && pidAlive(gpid));
  const bpid = hub.store.events(id).find((e) => e.type === 'attempt.started').data.pid;
  spawnSync('taskkill', ['/PID', String(r.pid), '/F'], { stdio: 'ignore' }); // chi runner, KHONG /T
  await sleep(1500);
  assert.equal(pidAlive(bpid), false, 'jobrun/backend chet theo runner');
  assert.equal(pidAlive(gpid), false, 'chau chet theo');
});

test('D4b: host GUI don bang `taskkill /PID <mcp> /T /F` (kieu Codex Desktop #34260) -> runner qua trampoline VAN SONG va task xong', { skip: !isWin }, async () => {
  const root = tmp();
  const hubJs = path.join(here, '..', 'lib', 'hub.mjs');
  // "MCP server" gia: tao Hub voi detachedLauncher mac dinh (trampoline), spawn task slow, in task_id, roi song tiep
  const code = `const {Hub}=await import(${JSON.stringify('file:///' + hubJs.replace(/\\/g, '/'))});`
    + `const h=new Hub({root:${JSON.stringify(root)}});h.maxActive=h.maxActivePerCwd=1000;`
    + `const r=await h.spawn(${JSON.stringify(spec('slow', { cwd: root }))});console.log(r.task_id);setInterval(()=>{},1000);`;
  const mcp = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ORCH_ENABLE_FAKE: '1' }, windowsHide: true });
  const id = await new Promise((r) => mcp.stdout.once('data', (d) => r(String(d).trim())));
  const hub = new Hub({ root, launcher: () => {} });
  const t0 = Date.now();
  while (!hub.store.runnerStarted(id) && Date.now() - t0 < 15_000) await sleep(50);
  assert.ok(hub.store.runnerStarted(id), 'runner da khoi dong');
  spawnSync('taskkill', ['/PID', String(mcp.pid), '/T', '/F'], { stdio: 'ignore' });
  const w = await hub.wait([id], { timeoutMs: 20_000 });
  assert.equal(w.tasks[0].status, 'succeeded', 'runner khong bi taskkill /T cua host keo theo');
});

// ---------------- E6 / N6 ----------------
test('E6/N6 Q5: cung idempotency_key o 2 project -> 2 task rieng; tran theo cwd', async () => {
  const hub = makeHub({ noop: true });
  const a = tmp('projA-'); const b = tmp('projB-');
  const ra = await hub.spawn(spec('ok', { cwd: a, idempotency_key: 'k1' }));
  const rb = await hub.spawn(spec('ok', { cwd: b, idempotency_key: 'k1' }));
  assert.notEqual(ra.task_id, rb.task_id);
  assert.equal(rb.created, true);
  assert.equal((await hub.spawn(spec('ok', { cwd: a.toUpperCase(), idempotency_key: 'k1' }))).task_id, isWin ? ra.task_id : undefined ?? (await hub.spawn(spec('ok', { cwd: a, idempotency_key: 'k1' }))).task_id);
  hub.maxActivePerCwd = 2;
  await hub.spawn(spec('ok', { cwd: a }));
  await assert.rejects(hub.spawn(spec('ok', { cwd: a })), /ORCH_MAX_ACTIVE_PER_CWD/);
  await hub.spawn(spec('ok', { cwd: b })); // project khac van spawn duoc
});

function runCli(args, { input = '', env = {} } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(BIN, 'orch.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
    c.stdin.end(input);
  });
}
test('E6/N6: inbox --hook chi bao task cua project cua phien (cwd tu stdin); --all bao het', async () => {
  const hub = makeHub({ noop: true });
  const a = tmp('projA-'); const b = tmp('projB-');
  hub.store.notify('tA', { status: 'succeeded', cwd: path.join(a, 'sub') });
  hub.store.notify('tB', { status: 'succeeded', cwd: b });
  const r1 = await runCli(['inbox', '--hook', '--root', hub.store.root], { input: JSON.stringify({ session_id: 's1', cwd: a }) });
  assert.equal(r1.code, 0);
  assert.match(r1.out, /tA/);
  assert.doesNotMatch(r1.out, /tB/);
  const r2 = await runCli(['inbox', '--hook', '--all', '--root', hub.store.root], { input: JSON.stringify({ session_id: 's2', cwd: a }) });
  assert.match(r2.out, /tA/); assert.match(r2.out, /tB/);
});

// ---------------- E7 / N8 + N9 ----------------
test('E7/N8: .ps1 khong bao gio di qua powershell -File: shim npm -> node-shim; co .cmd canh -> cmd; con lai -> ENOENT', { skip: !isWin }, () => {
  const dir = tmp('orch ps1 ');
  const pkg = path.join(dir, 'node_modules', '@x', 'cli', 'bin'); fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'cli.js'), '');
  fs.writeFileSync(path.join(dir, 'xcli.ps1'), [
    '#!/usr/bin/env pwsh', '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent', '$exe=""',
    'if (Test-Path "$basedir/node$exe") {', '  & "$basedir/node$exe"  "$basedir/node_modules/@x/cli/bin/cli.js" $args', '} else {',
    '  & "node$exe"  "$basedir/node_modules/@x/cli/bin/cli.js" $args', '}', 'exit $LASTEXITCODE', ''].join('\r\n'));
  const env = { ...process.env, PATHEXT: '.PS1;.COM;.EXE;.BAT;.CMD' };
  const p = planSpawn(path.join(dir, 'xcli.ps1'), ['a'], env);
  assert.equal(p.via, 'node-shim'); assert.equal(p.args[0], path.join(pkg, 'cli.js'));
  fs.writeFileSync(path.join(dir, 'tool.ps1'), 'node x.js @args');
  fs.writeFileSync(path.join(dir, 'tool.cmd'), '@echo off\r\nnode x.js %*\r\n');
  assert.equal(planSpawn(path.join(dir, 'tool.ps1'), [], env).via, 'cmd');
  fs.writeFileSync(path.join(dir, 'lone.ps1'), 'Write-Host hi');
  assert.throws(() => planSpawn(path.join(dir, 'lone.ps1'), [], env), (e) => e.code === 'ENOENT');
});

test('E7/N9: oneOf/allOf/not/$ref/$defs/patternProperties/prefixItems/tuple -> khong strictable -> tat schema native', () => {
  const o = (x) => ({ type: 'object', properties: { v: x }, required: ['v'] });
  for (const s of [
    o({ oneOf: [{ type: 'string' }, { type: 'number' }] }),
    { allOf: [{ type: 'object', properties: { a: { type: 'string' } } }] },
    o({ not: { type: 'null' } }),
    { type: 'object', properties: { p: { $ref: '#/$defs/P' } }, $defs: { P: { type: 'object', properties: { x: { type: 'string' } } } } },
    o({ type: 'array', items: [{ type: 'string' }, { type: 'number' }] }),
    o({ type: 'array', prefixItems: [{ type: 'string' }] }),
  ]) {
    assert.equal(isStrictable(s), false, JSON.stringify(s));
    assert.equal(strictFinalSchema({ output_schema: s }), null);
  }
  assert.equal(isStrictable(o({ anyOf: [{ type: 'string' }, { type: 'null' }] })), true);
});

// ---------------- E8 / N10 ----------------
test('E8/N10: chet giua followup.accepted va xoa file -> runner sau KHONG nhan lai (turn tang 1 lan)', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('ok'));
  await runTaskLoop(hub.store, id, hub.opts);
  const f = await hub.followup(id, 'them');
  // mo phong runner chet ngay sau append followup.accepted (file chua bi xoa)
  const j = hub.store.openJournal(id);
  j.append('followup.accepted', { count: 1, ids: [f.followup_id], prompts: ['them'] });
  assert.equal(hub.store.pendingFollowups(id), 1);
  await runTaskLoop(hub.store, id, hub.opts);
  const s = hub.store.state(id);
  assert.equal(s.turn, 2);
  assert.equal(count(hub, id, 'followup.accepted'), 1);
  assert.equal(hub.store.pendingFollowups(id), 0);
  assert.equal(s.status, 'succeeded');
  const w = await hub.wait([id], { until_followup: f.followup_id, timeoutMs: 2000 });
  assert.equal(w.timed_out, false);
});

test('E8/N10: state.json cu hon journal (chet giua append va ghi snapshot) -> state() fold lai; Journal mo ra ghi lai snapshot', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('ok'));
  await runTaskLoop(hub.store, id, hub.opts);
  const snap = JSON.parse(fs.readFileSync(hub.store.file(id, 'state.json'), 'utf8'));
  fs.appendFileSync(hub.store.file(id, 'events.jsonl'), JSON.stringify({ seq: snap.last_seq + 1, ts: new Date().toISOString(), type: 'followup.accepted', data: { ids: ['fX'], prompts: ['x'] } }) + '\n');
  assert.equal(hub.store.state(id).turn, 2, 'khong ket o snapshot cu');
  hub.store.openJournal(id);
  assert.equal(JSON.parse(fs.readFileSync(hub.store.file(id, 'state.json'), 'utf8')).turn, 2);
});

test('E8/N10: hai followup gop mot turn -> ca hai followup_id tro toi cung turn; prompt fresh giu moi followup', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: id } = await hub.spawn(spec('ok'));
  await runTaskLoop(hub.store, id, hub.opts);
  const f1 = await hub.followup(id, 'a'); const f2 = await hub.followup(id, 'b');
  await runTaskLoop(hub.store, id, hub.opts);
  const s = hub.store.state(id);
  assert.equal(s.followups[f1.followup_id].turn, 2);
  assert.equal(s.followups[f2.followup_id].turn, 2);
  const w = await hub.wait([id], { until_followup: f2.followup_id, timeoutMs: 2000 });
  assert.equal(w.timed_out, false);
});

// ---------------- E9 / N11 + N12 ----------------
test('E9/N11: defaultRoot tren Windows thieu LOCALAPPDATA -> %USERPROFILE%\\AppData\\Local, khong roi ve ~/.local/state', () => {
  const r = defaultRoot({ USERPROFILE: 'C:\\Users\\u' }, 'win32');
  assert.equal(r, path.join('C:\\Users\\u', 'AppData', 'Local', 'subagent-hub', 'default'));
  assert.equal(defaultRoot({ LOCALAPPDATA: 'D:\\L' }, 'win32'), path.join('D:\\L', 'subagent-hub', 'default'));
  assert.equal(defaultRoot({ ORCH_HOME: 'X' }, 'win32'), 'X');
  const e = envCheck({ PATH: 'x', SystemRoot: 'C:\\Windows' }, 'win32');
  assert.ok(e.missing.includes('LOCALAPPDATA'));
  assert.match(e.hint, /ORCH_HOME/);
});

test('E9/N12: doctor doc LimitFlags cua job ma tien trinh detached roi vao; verdict theo KILL_ON_JOB_CLOSE', { skip: !isWin }, async () => {
  assert.equal(jobVerdict({ in_job: false }).ok, true);
  assert.equal(jobVerdict({ in_job: true, limit_flags: 0x2000 | 0x800 }).ok, false);
  assert.equal(jobVerdict({ in_job: true, limit_flags: 0 }).ok, true);
  const { doctor } = await import('../lib/doctor.mjs');
  const rep = await doctor(JOBROOT, { backends: {} });
  assert.equal(typeof rep.checks.job_limits.in_job, 'boolean');
  assert.ok('limit_flags' in rep.checks.job_limits);
  assert.equal(rep.checks.jobrun.ok, true);
});

// ---------------- E10 / N14, D2, D6, D7, D1 ----------------
test('E10/N14: tin nhan cuoi sai hop dong: co output_schema -> failed/bad_output (giu text); khong co -> succeeded/degraded', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: a } = await hub.spawn(spec('bad_output_always', { output_schema: { type: 'object', properties: { n: { type: 'number' } } } }));
  await runTaskLoop(hub.store, a, hub.opts);
  const ra = hub.store.readResult(a);
  assert.equal(ra.status, 'failed'); assert.equal(ra.error.class, 'bad_output'); assert.match(ra.summary, /a\.js/);
  const { task_id: b } = await hub.spawn(spec('bad_output_always'));
  await runTaskLoop(hub.store, b, hub.opts);
  const rb = hub.store.readResult(b);
  assert.equal(rb.status, 'succeeded'); assert.equal(rb.format, 'degraded'); assert.equal(rb.error, null);
});

const hasGit = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
test('D2: huy task ghi khi workspace da doi -> warnings killed_mid_write', { skip: !hasGit }, async () => {
  const repo = tmp('orch-d2-');
  spawnSync('git', ['init', '-q'], { cwd: repo, windowsHide: true });
  const hub = makeHub({ noop: true, opts: { hooks: { on_notify: () => {}, pre_attempt: () => ({ grants: { write: true } }) } } });
  const { task_id: id } = await hub.spawn(spec('write_then_hang', { cwd: repo, access: 'write' }));
  const p = runTaskLoop(hub.store, id, hub.opts);
  await waitFile(path.join(repo, 'dang-do.txt'));
  await hub.cancel(id);
  await p;
  const r = hub.store.readResult(id);
  assert.equal(r.status, 'cancelled');
  assert.ok(r.warnings.includes('killed_mid_write'), JSON.stringify(r.warnings));
});

test('D6: cho slot lau -> slot.waiting{since} (mot lan)', async () => {
  const hub = makeHub({ noop: true, opts: { maxPerBackend: 1, slotWaitNoticeMs: 300 } });
  const { task_id: a } = await hub.spawn(spec('slow'));
  const { task_id: b } = await hub.spawn(spec('ok'));
  const pa = runTaskLoop(hub.store, a, hub.opts);
  await sleep(200);
  await runTaskLoop(hub.store, b, hub.opts);
  await pa;
  assert.equal(count(hub, b, 'slot.waiting'), 1);
  assert.equal(hub.store.state(b).status, 'succeeded');
});

test('D7: canary parser - loai su kien la + co final -> warnings unknown_events; khong co final -> bad_output parser_unrecognized', async () => {
  const hub = makeHub({ noop: true });
  const { task_id: a } = await hub.spawn(spec('unknown_extra'));
  await runTaskLoop(hub.store, a, hub.opts);
  assert.ok(hub.store.readResult(a).warnings.includes('unknown_events:1'));
  const { task_id: b } = await hub.spawn(spec('format_changed'));
  await runTaskLoop(hub.store, b, hub.opts);
  const f = hub.store.events(b).find((e) => e.type === 'attempt.failed');
  assert.equal(f.data.class, 'bad_output');
  assert.match(f.data.message, /parser_unrecognized/);
  assert.ok(hub.store.events(b).some((e) => e.type === 'parser.unknown_events'));
});

test('D3 + r3.1 F4: -c mcp_servers.<id>.enabled=false CHI cho muc hub co that trong config.toml (fresh lan resume)', async () => {
  const { createCodexAdapter, hubServerNames } = await import('../lib/adapters/codex.mjs');
  const home = tmp('orch-f4-home-'); const dir = tmp('orch-f4-proj-');
  const env = { CODEX_HOME: home };
  const sp = normalizeSpec({ prompt: 'p', cwd: dir });
  const cflags = (o = {}) => { const a = createCodexAdapter({ env, ...o }).buildInvocation({ spec: sp, prompt: 'p', sessionId: o.sid ?? null, attemptDir: dir }).args;
    assert.equal(a.at(-1), '-'); return a.filter((x, i) => a[i - 1] === '-c'); };
  // (a) khong co config.toml -> KHONG them -c nao (truoc r3.1: luon them -> muc thieu command/url)
  assert.deepEqual(cflags(), []);
  // (b) config co muc khac ten mac dinh nhung tro toi mcp-server.mjs + mot server khong lien quan
  fs.writeFileSync(path.join(home, 'config.toml'), [
    'model = "x"', '[mcp_servers.orch]', 'command = "node"', 'args = ["D:\\\\x\\\\src\\\\bin\\\\mcp-server.mjs"]',
    '[mcp_servers.orch.env]', 'ORCH_HOME = "D:\\\\h"', '', '[mcp_servers.docs]', 'url = "https://example.invalid/mcp"'].join('\n'));
  for (const sid of [null, 'th1']) assert.deepEqual(cflags({ sid }), ['mcp_servers.orch.enabled=false']);
  // (c) muc ten mac dinh "subagent-hub" (khoa cham o goc) + muc o .codex/config.toml cua du an (cha cua cwd) + ten co dau ngoac
  fs.writeFileSync(path.join(home, 'config.toml'), 'mcp_servers.subagent-hub.command = "orch-mcp"\n[mcp_servers."hub x"]\nargs = ["mcp-server.mjs"]\n');
  fs.mkdirSync(path.join(dir, '.codex'));
  const sub = path.join(dir, 'a', 'b'); fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), '[mcp_servers]\nlocalhub = { command = "node", args = ["mcp-server.mjs"] }\n');
  const { codexHubEntries, trustedProjects } = await import('../lib/adapters/codex.mjs');
  // du an CHUA trusted -> Codex bo qua .codex/ cua du an -> khong duoc them -c cho localhub
  assert.deepEqual(codexHubEntries({ cwd: sub, env }).names, ['subagent-hub']);
  fs.appendFileSync(path.join(home, 'config.toml'), `[projects.${JSON.stringify(dir)}]\ntrust_level = "trusted"\n`);
  assert.deepEqual(trustedProjects(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')), [dir]);
  const h = codexHubEntries({ cwd: sub, env });
  assert.deepEqual(h.names.sort(), ['localhub', 'subagent-hub'], 'du an trusted -> tinh ca .codex/config.toml cua du an');
  assert.deepEqual(h.skipped, ['hub x'], 'ten khong phai bare key -> bo, doctor canh bao');
  // (d) ORCH_CODEX_HUB_NAMES chi CHON trong cac muc co that, khong tao muc moi
  assert.deepEqual(codexHubEntries({ cwd: dir, env: { ...env, ORCH_CODEX_HUB_NAMES: 'khong-co,subagent-hub' } }).names.sort(), ['localhub', 'subagent-hub']);
  assert.deepEqual(hubServerNames('hub, orch-2,bad name;x'), ['hub', 'orch-2']);
  assert.deepEqual(hubServerNames(undefined, { ORCH_CODEX_HUB_NAMES: '' }), []);
});

function mcpClient(root) {
  const child = spawn(process.execPath, [path.join(BIN, 'mcp-server.mjs')], { env: { ...process.env, ORCH_HOME: root }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); pending.delete(m.id); }
  });
  let nid = 0;
  const rpc = (method, params) => new Promise((res) => { const id = ++nid; pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { rpc, close: () => child.kill() };
}
test('D1: client kieu 2026-07-28 (khong initialize, _meta protocolVersion + clientCapabilities tasks) -> loi co cau truc, khong treo', async () => {
  const c = mcpClient(tmp());
  try {
    const r = await c.rpc('tools/call', { name: 'subagent_list', arguments: {}, _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': { extensions: { 'io.modelcontextprotocol/tasks': {} } } } });
    assert.equal(r.error.code, -32602);
    assert.deepEqual(r.error.data.supported, ['2025-06-18', '2025-03-26', '2024-11-05']);
    const d = await c.rpc('server/discover', {});
    assert.equal(d.error.code, -32601);
    // client cu (khong _meta) goi tools/call ma khong initialize -> van phuc vu (ket qua dong bo, khong bao gio CreateTaskResult)
    const ok = await c.rpc('tools/call', { name: 'subagent_list', arguments: {} });
    assert.ok(Array.isArray(ok.result.structuredContent.tasks));
    assert.equal(ok.result.resultType, undefined);
  } finally { c.close(); }
});
