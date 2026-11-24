// Tien trinh Windows (B1, B17), xac thuc pid truoc khi kill (B10), chong de quy (B9), lease named pipe (B3).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveCommand, parseNpmCmdShim, planSpawn, spawnInvocation, procCreationTime, pidAlive, killTree } from '../lib/proc.mjs';
import { killVerifiedOrphan } from '../lib/runner.mjs';
import { detectParentTask } from '../lib/hub.mjs';
import { acquireLease, probeLease } from '../lib/lease.mjs';

const isWin = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orch-proc-'));
const ENV = (dir) => ({ ...process.env, PATH: dir, Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS' });

test('resolveCommand (B1): bo qua file khong duoi (shim sh cua npm), chon theo thu tu PATHEXT', { skip: !isWin }, () => {
  const d = tmp();
  for (const f of ['x', 'x.cmd', 'x.ps1']) fs.writeFileSync(path.join(d, f), '');
  assert.equal(path.basename(resolveCommand('x', ENV(d))), 'x.cmd');
  fs.writeFileSync(path.join(d, 'x.exe'), '');
  assert.equal(path.basename(resolveCommand('x', ENV(d))), 'x.exe', '.EXE dung truoc .CMD trong PATHEXT');
  assert.equal(path.basename(resolveCommand(path.join(d, 'x'), ENV(d))), 'x.exe', 'duong dan co thu muc cung theo PATHEXT');
  assert.equal(resolveCommand('khong-ton-tai', ENV(d)), null);
  assert.throws(() => planSpawn('khong-ton-tai', [], ENV(d)), /ENOENT/);
});

test('shim npm .cmd (B17): doc entry JS va chay node truc tiep, khong qua cmd.exe', { skip: !isWin }, () => {
  const d = tmp();
  const entry = path.join(d, 'node_modules', '@openai', 'codex', 'bin');
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'codex.js'), '');
  // noi dung that cua cmd-shim (rut gon)
  fs.writeFileSync(path.join(d, 'codex.cmd'), [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
  ].join('\r\n'));
  fs.writeFileSync(path.join(d, 'codex'), '#!/bin/sh\nexec node "$basedir/node_modules/@openai/codex/bin/codex.js" "$@"\n');
  const shim = parseNpmCmdShim(path.join(d, 'codex.cmd'));
  assert.equal(shim.kind, 'js');
  assert.equal(shim.target, path.join(entry, 'codex.js'));
  const p = planSpawn('codex', ['exec', '--json', '-'], ENV(d));
  assert.equal(p.via, 'node-shim');
  assert.equal(p.file, process.execPath);
  assert.deepEqual(p.args, [path.join(entry, 'codex.js'), 'exec', '--json', '-']);
  assert.equal(p.verbatim, false);
});

test('planSpawn tren may that (khong chay): npm phan giai duoc', { skip: !isWin }, () => {
  const p = planSpawn('npm', ['--version']);
  assert.ok(['node-shim', 'exe-shim', 'cmd', 'direct'].includes(p.via), JSON.stringify(p));
});

test('.cmd khong phai shim npm (B17): doi so chua metachar KHONG gay chen lenh, round-trip nguyen ven', { skip: !isWin }, async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'printargs.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");');
  // khong khop regex shim npm -> bat buoc di qua cmd.exe
  fs.writeFileSync(path.join(d, 'fakecli.cmd'), `@echo off\r\nset "D=%~dp0"\r\n"${process.execPath}" "%D%printargs.js" %*\r\n`);
  assert.equal(parseNpmCmdShim(path.join(d, 'fakecli.cmd')), null);
  const args = ['{"d":"a & echo INJECTED_MARKER"}', 'a|b', 'x > y.txt', '100%', '%OS%', 'a^b', '"quoted"', 'with space', '!bang!', '(paren)', 'back\\slash\\', ''];
  assert.equal(planSpawn(path.join(d, 'fakecli'), args, ENV(d)).via, 'cmd');
  const child = spawnInvocation({ command: path.join(d, 'fakecli'), args, cwd: d, env: { PATH: d + path.delimiter + process.env.PATH } });
  child.stdin.end();
  let out = '';
  child.stdout.on('data', (x) => { out += x; });
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0);
  const lines = out.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, `co lenh thu hai chay: ${out}`);
  assert.deepEqual(JSON.parse(lines[0]), args);
  assert.ok(!fs.existsSync(path.join(d, 'y.txt')), 'redirect khong duoc thuc thi');
  assert.throws(() => planSpawn(path.join(d, 'fakecli'), ['a\nb'], ENV(d)), /xuong dong/);
});

test('killVerifiedOrphan (B10): chi kill khi pid con song VA thoi diem tao khop', () => {
  const killed = [];
  const kill = (p) => killed.push(p);
  const ev = (pid, at) => ({ data: { pid, spawned_at: at } });
  const now = Date.now();
  assert.equal(killVerifiedOrphan(ev(10, now), { alive: () => false, creationTime: () => now, kill }).killed, false);
  assert.equal(killVerifiedOrphan(ev(10, now), { alive: () => true, creationTime: () => now - 3_600_000, kill }).reason, 'pid da bi tai su dung');
  assert.equal(killVerifiedOrphan(ev(10, now), { alive: () => true, creationTime: () => null, kill }).killed, false);
  assert.equal(killVerifiedOrphan(null, { kill }).killed, false);
  assert.deepEqual(killed, []);
  assert.equal(killVerifiedOrphan(ev(10, now), { alive: () => true, creationTime: () => now + 800, kill }).killed, true);
  assert.deepEqual(killed, [10]);
});

test('procCreationTime: khop thoi diem spawn cua tien trinh that (dung sai < 10s)', async () => {
  const t0 = Date.now();
  const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore', windowsHide: true });
  try {
    await new Promise((r) => c.once('spawn', r));
    const ct = procCreationTime(c.pid);
    assert.ok(ct !== null, 'doc duoc creation time');
    assert.ok(Math.abs(ct - t0) < 10_000, `lech ${ct - t0}ms`);
  } finally {
    killTree(c.pid);
  }
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(pidAlive(c.pid), false);
});

test('detectParentTask (B9): to tien la backend cua task dang chay -> loi goi tu worker', () => {
  const running = [{ task_id: 't1', backend_pid: 500, depth: 1 }, { task_id: 't2', backend_pid: 900, depth: 2 }];
  assert.equal(detectParentTask([123, 900, 4], running).task_id, 't2');
  assert.equal(detectParentTask([123, 4], running), null);
  assert.equal(detectParentTask([], []), null);
});

test('lease named pipe (B3): loai tru, probe tra info + poke, tu nha khi dong', async () => {
  const root = tmp();
  let poked = null;
  const a = await acquireLease(root, 'task-x', { info: () => ({ who: 'a' }), onPoke: (m) => { poked = m; } });
  assert.ok(a);
  assert.equal(await acquireLease(root, 'task-x'), null, 'ben thu hai khong chiem duoc');
  const p = await probeLease(root, 'task-x', { msg: { poke: 'cancel' } });
  assert.equal(p.alive, true);
  assert.equal(p.info.who, 'a');
  assert.deepEqual(poked, { poke: 'cancel' });
  await a.release();
  assert.equal((await probeLease(root, 'task-x')).alive, false);
  const b = await acquireLease(root, 'task-x');
  assert.ok(b, 'nha xong thi chiem lai duoc');
  await b.release();
  // root khac -> ten pipe khac
  const c = await acquireLease(tmp(), 'task-x');
  const d = await acquireLease(root, 'task-x');
  assert.ok(c && d);
  await c.release(); await d.release();
});

test('lease: tien trinh giu lease bi kill -> OS tu nha (khong can dong ho/heartbeat)', async () => {
  const root = tmp();
  const leaseMod = new URL('../lib/lease.mjs', import.meta.url).href;
  const holder = spawn(process.execPath, ['--input-type=module', '-e',
    `import { acquireLease } from ${JSON.stringify(leaseMod)}; const l = await acquireLease(${JSON.stringify(root)}, 'task-k'); console.log(l ? 'held' : 'no'); setInterval(() => {}, 1000);`],
  { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const first = await new Promise((r) => holder.stdout.once('data', (d) => r(String(d).trim())));
  assert.equal(first, 'held');
  assert.equal(await acquireLease(root, 'task-k'), null);
  holder.kill('SIGKILL');
  await new Promise((r) => holder.once('exit', r));
  const l = await acquireLease(root, 'task-k');
  assert.ok(l, 'sau khi holder chet, lease chiem lai duoc ngay');
  await l.release();
});

test('doctor (C5): khong chay backend; lease/store ok; phan giai lenh; job co verdict', async () => {
  const { doctor } = await import('../lib/doctor.mjs');
  const r = await doctor(tmp(), { backends: { nodejs: 'node', missing: 'khong-co-lenh-nay-xyz' } });
  assert.equal(r.checks.store.ok, true);
  assert.equal(r.checks.lease.ok, true);
  assert.equal(r.checks.commands.nodejs.ok, true);
  assert.equal(r.checks.commands.missing.ok, false);
  if (isWin) assert.ok(r.checks.job.verdict || r.checks.job.error);
});
