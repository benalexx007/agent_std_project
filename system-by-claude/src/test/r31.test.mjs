// Test r3.1: moi test ung voi mot muc F*/M* cua docs/06-critique-r3.md (khong chay backend that).
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
import { TaskStore, normCwd } from '../lib/store.mjs';
import { createFakeAdapter } from '../lib/adapters/fake.mjs';
import { pidAlive } from '../lib/proc.mjs';
import { acquireLease, probeLease, leaseName, classifyPipeError } from '../lib/lease.mjs';
import { ensureJobrun, smokeJobrun, detachedJobInfo, JOBRUN_HASH, _resetJobrunCache } from '../lib/jobrun.mjs';
import { resultContract, normalizeSpec } from '../lib/schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, '..', 'bin');
const tmp = (p = 'orch-r31-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWin = process.platform === 'win32';
const JOBROOT = tmp('orch-r31-jobrun ');
const JR = ensureJobrun(JOBROOT);
const PS = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function makeHub({ opts = {}, root = tmp() } = {}) {
  const adapters = { fake: createFakeAdapter() };
  const hub = new Hub({ root, launcher: () => {} });
  hub.opts = { adapters, pollMs: 50, hooks: { on_notify: () => {} }, jobrunExe: null, ...opts };
  hub.maxActive = 1000; hub.maxActivePerCwd = 1000;
  return hub;
}
const spec = (scenario, extra = {}) => ({ prompt: 'lam viec X', backend: 'fake', cwd: process.cwd(), backend_options: { fake: { scenario } }, ...extra });
const types = (hub, id) => hub.store.events(id).map((e) => e.type);
async function waitFile(f, ms = 10_000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fs.existsSync(f) && fs.readFileSync(f, 'utf8')) return fs.readFileSync(f, 'utf8'); await sleep(100); } return null; }
function runCli(args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(BIN, 'orch.mjs'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}

// ---------------- F1 (M1): pipe lease do tien trinh khac quyen giu ----------------
test('F1: classifyPipeError - EADDRINUSE=held, EPERM/EACCES=foreign, EBUSY=busy, ENOENT=dead', () => {
  assert.equal(classifyPipeError('EADDRINUSE'), 'held');
  assert.equal(classifyPipeError('EPERM'), 'foreign');
  assert.equal(classifyPipeError('EACCES'), 'foreign');
  assert.equal(classifyPipeError('EBUSY'), 'busy');
  assert.equal(classifyPipeError('ENOENT'), 'dead');
});

/** Giu pipe lease bang NamedPipeServerStream voi DACL han che (SYSTEM full, Everyone read) - nhu pipe cua tien trinh elevated. */
async function holdForeignPipe(root, name) {
  const pipe = leaseName(root, name).replace('\\\\.\\pipe\\', '');
  const ps = `$sec = New-Object System.IO.Pipes.PipeSecurity
$sec.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')), 'FullControl', 'Allow')))
$sec.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule((New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')), 'Read', 'Allow')))
$p = New-Object System.IO.Pipes.NamedPipeServerStream('${pipe}', 'InOut', 4, 'Byte', 'Asynchronous', 0, 0, $sec)
[Console]::Out.WriteLine('UP'); [Console]::Out.Flush()
Start-Sleep -Seconds 90`;
  const holder = spawn(PS, ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const up = await new Promise((r) => { holder.stdout.on('data', (d) => { if (String(d).includes('UP')) r(true); }); holder.on('close', () => r(false)); });
  return { holder, up };
}

test('F1/J4: pipe lease bi giu boi tien trinh khac quyen -> probe "foreign", runner ghi lease_permission, hub runner_failed ngay, KHONG relaunch', { skip: !isWin }, async () => {
  const root = tmp('orch r31 f1 ');
  let launches = 0;
  const hub = new Hub({ root, launcher: () => { launches++; } });
  hub.maxActive = hub.maxActivePerCwd = 1000;
  const { task_id: id } = await hub.spawn(spec('ok', { cwd: root })); // launch #1 (no-op: runner chua chay)
  const { holder, up } = await holdForeignPipe(root, `task-${id}`);
  try {
    assert.ok(up, 'tao duoc pipe DACL han che');
    assert.equal(await acquireLease(root, `task-${id}`), null, 'listen -> EADDRINUSE (libuv doi ACCESS_DENIED) -> coi la held');
    const p = await probeLease(root, `task-${id}`);
    assert.equal(p.alive, 'foreign', JSON.stringify(p));
    // runner: khong im lang bo qua (truoc r3.1: {skipped:'lease_held'} -> hub relaunch vo han)
    await assert.rejects(runTask(hub.store, id, { adapters: { fake: createFakeAdapter() }, pollMs: 50, hooks: { on_notify: () => {} } }), (e) => e.code === 'lease_permission');
    // runner-main that: ghi runner.fatal.json lease_permission
    const r = spawnSync(process.execPath, [path.join(BIN, 'runner-main.mjs'), '--root', root, id], { env: { ...process.env, ORCH_HOME: root }, windowsHide: true, timeout: 30_000 });
    assert.notEqual(r.status, 0);
    assert.equal(hub.runnerFailure(id)?.class, 'lease_permission');
    hub.store.clearRunnerFailure(id); // hub van phai tu nhan ra qua probe, khong can fatal
    const t0 = Date.now();
    const w = await hub.wait([id], { timeoutMs: 20_000 });
    assert.equal(w.timed_out, false);
    assert.equal(w.tasks[0].status, 'runner_failed');
    assert.equal(w.tasks[0].error.class, 'lease_permission');
    assert.ok(Date.now() - t0 < 5000, `bao ngay (${Date.now() - t0}ms)`);
    assert.equal(launches, 1, 'khong relaunch khi pipe cua tien trinh khac quyen');
  } finally { holder.kill(); }
});

// ---------------- F2 (M2/R1): followup bi cancel bo -> wait(min_turn) khong treo ----------------
test('F2/J10: xong -> followup -> cancel: brief co cancel{at,dropped}; wait(min_turn:2) tra ngay min_turn_unreachable', async () => {
  const hub = makeHub();
  const { task_id: id } = await hub.spawn(spec('ok'));
  await runTaskLoop(hub.store, id, hub.opts);
  const f = await hub.followup(id, 'lam them X');
  assert.equal(f.turn, undefined, 'followup khong tra `turn` (uoc luong sai khi bi cancel bo)');
  assert.equal(f.turn_estimate, 2);
  await hub.cancel(id);
  await runTaskLoop(hub.store, id, hub.opts);
  const st = await hub.status(id);
  assert.deepEqual(st.cancel.dropped, [f.followup_id]);
  assert.ok(st.cancel.at);
  const t0 = Date.now();
  const w = await hub.wait([id], { min_turn: 2, timeoutMs: 10_000 });
  assert.equal(w.timed_out, false);
  assert.equal(w.tasks[0].min_turn_unreachable, true);
  assert.equal(w.tasks[0].cancel.dropped[0], f.followup_id);
  assert.ok(Date.now() - t0 < 2000);
  // CLI `orch wait --min-turn 2 --until-done` (Bash nen cua Claude Code) cung ket thuc ngay
  const r = await runCli(['wait', id, '--min-turn', '2', '--until-done', '--deadline', '20000', '--root', hub.store.root]);
  const o = JSON.parse(r.out);
  assert.equal(o.deadline_exceeded, undefined);
  assert.equal(o.tasks[0].min_turn_unreachable, true);
  // followup MOI sau cancel -> cancel xoa khoi brief, turn 2 chay that
  await hub.followup(id, 'viec moi');
  await runTaskLoop(hub.store, id, hub.opts);
  const s2 = await hub.status(id);
  assert.equal(s2.turn, 2); assert.equal(s2.cancel ?? null, null);
});

test('F2: task bi huy GIUA turn 1 (khong co followup) -> wait(min_turn:2) cung khong treo', async () => {
  const hub = makeHub();
  const { task_id: id } = await hub.spawn(spec('slow'));
  const p = runTaskLoop(hub.store, id, hub.opts);
  await sleep(300);
  await hub.cancel(id);
  await p;
  const w = await hub.wait([id], { min_turn: 2, timeoutMs: 5000 });
  assert.equal(w.timed_out, false);
  assert.equal(w.tasks[0].status, 'cancelled');
  assert.equal(w.tasks[0].min_turn_unreachable, true);
});

test('F2: MCP subagent_wait KHONG con min_turn trong inputSchema (chi until_followup)', async () => {
  const child = spawn(process.execPath, [path.join(BIN, 'mcp-server.mjs')], { env: { ...process.env, ORCH_HOME: tmp() }, stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    const res = await new Promise((resolve) => {
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id === 2) resolve(m); } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    });
    const w = res.result.tools.find((t) => t.name === 'subagent_wait');
    assert.equal('min_turn' in w.inputSchema.properties, false);
    assert.ok('until_followup' in w.inputSchema.properties);
    const c = res.result.tools.find((t) => t.name === 'subagent_cancel');
    assert.match(c.description, /cancel\.dropped/);
  } finally { child.kill(); }
});

// ---------------- F3 (M3): jobrun hong / bi chan ----------------
test('F3: jobrun trong cache hong (0 byte) -> ensureJobrun tu kiem, bien dich lai, exec_ok', { skip: !isWin }, () => {
  const root = tmp('orch r31 f3a ');
  fs.mkdirSync(path.join(root, 'bin'));
  const exe = path.join(root, 'bin', `jobrun-${JOBRUN_HASH}.exe`);
  fs.writeFileSync(exe, '');
  _resetJobrunCache();
  const r = ensureJobrun(root);
  assert.equal(r.exe, exe, JSON.stringify(r));
  assert.equal(r.exec_ok, true);
  assert.ok(fs.statSync(exe).size > 0);
  assert.ok(fs.existsSync(exe.replace(/\.exe$/, '.ok')), 'ghi .ok sau tu kiem');
  assert.equal(smokeJobrun(exe).ok, true);
});

test('F3/J2-c: runner nhan jobrun HONG -> danh dau .bad, chay lai thang khong qua jobrun, task succeeded + warnings jobrun_unavailable', { skip: !isWin }, async () => {
  const dir = tmp('orch r31 f3b ');
  const bad = path.join(dir, 'jobrun-broken.exe');
  fs.writeFileSync(bad, ''); // nhu exe bi AV cat con 0 byte / AppLocker chan
  const hub = makeHub({ opts: { jobrunExe: bad } });
  const { task_id: id } = await hub.spawn(spec('ok'));
  await runTaskLoop(hub.store, id, hub.opts);
  const res = hub.store.readResult(id);
  assert.equal(res.status, 'succeeded', JSON.stringify(res.error));
  assert.ok(res.warnings.includes('jobrun_unavailable'), JSON.stringify(res.warnings));
  const ev = hub.store.events(id).find((e) => e.type === 'jobrun.unavailable');
  assert.match(ev.data.reason, /spawn (EFTYPE|UNKNOWN|EACCES|EINVAL)/);
  assert.equal(hub.store.events(id).filter((e) => e.type === 'attempt.failed').length, 0, 'khong tinh vao max_attempts');
  assert.ok(fs.existsSync(path.join(dir, 'jobrun-broken.bad')));
});

test('F3: .bad con han -> ensureJobrun tra exe:null (khong thu lai moi runner); xoa .bad -> thu lai', { skip: !isWin }, () => {
  const root = tmp('orch r31 f3c ');
  fs.mkdirSync(path.join(root, 'bin'));
  const badFile = path.join(root, 'bin', `jobrun-${JOBRUN_HASH}.bad`);
  fs.writeFileSync(badFile, JSON.stringify({ at: Date.now(), reason: 'spawn EFTYPE (gia lap)' }));
  _resetJobrunCache();
  const r = ensureJobrun(root);
  assert.equal(r.exe, null);
  assert.match(r.error, /EFTYPE/);
  fs.unlinkSync(badFile);
  _resetJobrunCache();
  assert.equal(ensureJobrun(root).exec_ok, true);
});

test('F3: runner-main thay ensureJobrun tra null (.bad / bi chan) -> task van chay, envelope co warnings jobrun_unavailable', async () => {
  const hub = makeHub({ opts: { jobrunExe: null, jobrunUnavailableReason: 'jobrun bi danh dau hong (gia lap)' } });
  const { task_id: id } = await hub.spawn(spec('ok'));
  await runTaskLoop(hub.store, id, hub.opts);
  const r = hub.store.readResult(id);
  assert.equal(r.status, 'succeeded');
  assert.ok(r.warnings.includes('jobrun_unavailable'));
});

// ---------------- F5 (M8) ----------------
test('F5: ensureJobrun KHONG nem loi (bin la file) va doctor van tra bao cao', { skip: !isWin }, async () => {
  const root = tmp('orch r31 f5 ');
  fs.writeFileSync(path.join(root, 'bin'), 'khong phai thu muc');
  _resetJobrunCache();
  const r = ensureJobrun(root);
  assert.equal(r.exe, null);
  assert.ok(r.error);
  const { doctor } = await import('../lib/doctor.mjs');
  const rep = await doctor(root, { backends: {} });
  assert.equal(rep.checks.jobrun.ok, false);
  assert.equal(rep.checks.jobrun.exec_ok, false);
  assert.ok(rep.checks.codex_hub, 'doctor co muc codex_hub (F4)');
});

test('F5/M8-d: thieu ComSpec -> jobrun --jobinfo van tao duoc cmd (khong "denied:87" gia)', { skip: !isWin || !JR.exe }, async () => {
  const prev = process.env.ComSpec;
  const ref = await detachedJobInfo(JR.exe, path.join(JOBROOT, `ji-a-${process.pid}.json`));
  delete process.env.ComSpec;
  try {
    const info = await detachedJobInfo(JR.exe, path.join(JOBROOT, `ji-b-${process.pid}.json`));
    assert.ok(info && ref, 'co ket qua');
    assert.notEqual(info.breakaway, 'denied:87', 'truoc r3.1: dong lenh " /c exit 0" -> ERROR_INVALID_PARAMETER');
    assert.equal(info.breakaway, ref.breakaway, 'giong khi co ComSpec');
  } finally { if (prev !== undefined) process.env.ComSpec = prev; }
});

// ---------------- M5: chan launch theo store + runner_failed can >= 15s ----------------
test('M5: 3 launch trong 14s (runner khoi dong cham) -> CHUA runner_failed; 2 hub poll cung luc khong launch them trong 5s', async () => {
  const root = tmp();
  let launches = 0;
  const h1 = new Hub({ root, launcher: () => { launches++; } });
  h1.maxActive = h1.maxActivePerCwd = 1000;
  const { task_id: id } = await h1.spawn(spec('ok'));
  const cdir = h1.store.controlDir(id);
  for (const f of fs.readdirSync(cdir).filter((x) => x.startsWith('launch-'))) fs.unlinkSync(path.join(cdir, f));
  const now = Date.now();
  for (const dt of [14_000, 9_000, 4_000]) fs.writeFileSync(path.join(cdir, `launch-${now - dt}-aa.json`), '{}');
  const h2 = new Hub({ root, launcher: () => { launches++; } });
  for (let i = 0; i < 4; i++) {
    for (const h of [h1, h2]) { const s = await h.status(id); assert.notEqual(s.status, 'runner_failed', JSON.stringify(s.error)); }
  }
  assert.equal(launches - 1, 0, 'launch gan nhat 4s truoc -> khong hub nao launch them');
  assert.equal(h1.store.launches(id).length, 3);
});

// ---------------- M6: normCwd giai 8.3 va junction ----------------
test('M6: cwd qua junction / ten 8.3 -> cung project (idempotency_key trung, tran theo cwd dung)', { skip: !isWin }, async () => {
  const base = fs.realpathSync.native(tmp('orch r31 m6 long name '));
  const target = path.join(base, 'du an that'); fs.mkdirSync(target);
  const link = path.join(base, 'loi tat');
  const mk = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'mklink', '/J', link, target], { windowsHide: true, encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);
  assert.equal(normCwd(link), normCwd(target));
  assert.equal(normCwd(path.join(link, '.')), normCwd(target));
  // path CHUA ton tai (cwd con) -> giai to tien gan nhat ton tai -> cung dang voi path ton tai
  assert.equal(normCwd(path.join(link, 'chua co', 'x')), normCwd(path.join(target, 'chua co', 'x')));
  assert.ok(normCwd(path.join(link, 'chua co')).startsWith(normCwd(target)));
  const short = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', `for %I in ("${target}") do @echo %~sI`], { windowsHide: true, encoding: 'utf8', windowsVerbatimArguments: false }).stdout.trim();
  if (short && short.includes('~')) assert.equal(normCwd(short), normCwd(target), `8.3: ${short}`);
  const hub = makeHub();
  const a = await hub.spawn(spec('ok', { cwd: target, idempotency_key: 'k-m6' }));
  const b = await hub.spawn(spec('ok', { cwd: link, idempotency_key: 'k-m6' }));
  assert.equal(b.task_id, a.task_id);
  assert.equal(b.created, false);
});

// ---------------- M9 (R6): JOB_LIST ----------------
for (const noJobList of ['0', '1']) {
  test(`M9: ORCH_JOBRUN_NO_JOBLIST=${noJobList} -> duong ${noJobList === '1' ? 'SUSPENDED+Assign' : 'PROC_THREAD_ATTRIBUTE_JOB_LIST'}; cancel -> "chau" start /b chet`, { skip: !isWin || !JR.exe }, async () => {
    const prev = { d: process.env.ORCH_JOBRUN_DEBUG, n: process.env.ORCH_JOBRUN_NO_JOBLIST };
    process.env.ORCH_JOBRUN_DEBUG = '1'; process.env.ORCH_JOBRUN_NO_JOBLIST = noJobList;
    try {
      const hub = makeHub({ opts: { jobrunExe: JR.exe } });
      const { task_id: id } = await hub.spawn(spec('grandchild'));
      const p = runTaskLoop(hub.store, id, hub.opts);
      const gpid = Number(await waitFile(path.join(hub.store.taskDir(id), 'grandchild.pid')));
      assert.ok(gpid > 0 && pidAlive(gpid));
      await hub.cancel(id);
      await p;
      await sleep(500);
      assert.equal(pidAlive(gpid), false, 'chau chet cung job');
      const err = fs.readFileSync(path.join(hub.store.attemptDir(id, 1), 'stderr.log'), 'utf8');
      assert.match(err, new RegExp(`\\[jobrun-debug\\] ${noJobList === '1' ? 'suspended' : 'joblist'}`));
    } finally {
      for (const [k, v] of [['ORCH_JOBRUN_DEBUG', prev.d], ['ORCH_JOBRUN_NO_JOBLIST', prev.n]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
}

// ---------------- M10 + M7 ----------------
test('M10: progress cuoi (chua flush do gop 1s) duoc ghi TRUOC attempt.exited', async () => {
  const hub = makeHub();
  const { task_id: id } = await hub.spawn(spec('progress_burst'));
  await runTaskLoop(hub.store, id, hub.opts);
  const evs = hub.store.events(id);
  const last = evs.findIndex((e) => e.type === 'progress' && e.data.text === 'p-cuoi');
  const exited = evs.findIndex((e) => e.type === 'attempt.exited');
  assert.ok(last >= 0, types(hub, id).join(','));
  assert.ok(last < exited, `progress(${last}) truoc attempt.exited(${exited})`);
});

test('M7: hop dong ket qua bao worker rang tien trinh nen se bi dung khi ket thuc luot', () => {
  assert.match(resultContract(normalizeSpec({ prompt: 'p', cwd: process.cwd() })), /tien trinh nen .* bi dung/);
});
