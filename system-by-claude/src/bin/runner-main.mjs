#!/usr/bin/env node
// Diem vao cua runner tach roi: node runner-main.mjs --root <dir> <task_id>
// r3 (N3/N7): ghi runner.started.json NGAY khi khoi dong (hub biet launch co toi noi); loi truoc/ngoai vong chay
// (hook policy hong, lease_permission, loi khong bat duoc) -> runner.fatal.json {message}; hub tra status runner_failed
// va NGUNG tu chua cho toi khi subagent_resume.
// r3 (N5): Windows -> chuan bi jobrun.exe (bien dich 1 lan, cache theo hash) de boc backend trong job KILL_ON_JOB_CLOSE.
import fs from 'node:fs';
import path from 'node:path';
import { TaskStore } from '../lib/store.mjs';
import { runTaskLoop, killActiveChildren } from '../lib/runner.mjs';
import { defaultAdapters } from '../lib/hub.mjs';
import { loadHooks } from '../lib/hooks.mjs';
import { flushToasts } from '../lib/notify.mjs';
import { ensureJobrun } from '../lib/jobrun.mjs';

const argv = process.argv.slice(2);
const ri = argv.indexOf('--root');
const root = ri >= 0 ? argv[ri + 1] : undefined;
const taskId = argv.filter((a, i) => !a.startsWith('--') && i !== ri + 1)[0];
if (!taskId) { console.error('thieu task_id'); process.exit(2); }

const store = new TaskStore(root);
const logFile = path.join(store.taskDir(taskId), 'runner.log');
const log = (m) => { try { fs.appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] ${m}\n`); } catch {} };
try { store.markRunnerStarted(taskId); } catch (e) { log(`khong ghi duoc runner.started: ${e.message}`); }

const fatal = (msg) => { log(`FATAL: ${msg}`); store.writeRunnerFatal(taskId, msg); };

// B10: loi ngoai try/catch (callback, timer) -> kill backend dang chay TRUOC khi chet, khong de lai mo coi.
// Runner tiep quan sau se ghi task.interrupted va resume. r3: con ghi runner.fatal.json (loi lap lai -> khong relaunch vo han).
const die = (kind) => (e) => { fatal(`${kind}: ${e?.stack ?? e}`); killActiveChildren(); process.exit(1); };
process.on('uncaughtException', die('uncaughtException'));
process.on('unhandledRejection', die('unhandledRejection'));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  try { process.on(sig, () => { log(`nhan ${sig}`); killActiveChildren(); process.exit(1); }); } catch {}
}

try {
  const hooks = await loadHooks();
  const jr = ensureJobrun(store.root);
  if (!jr.exe && process.platform === 'win32') log(`jobrun khong dung duoc (${jr.error}) -> backend chay khong co job rieng (chau co the song sot khi huy)`);
  else if (jr.compiled_ms) log(`jobrun bien dich ${jr.compiled_ms}ms: ${jr.exe}`);
  await runTaskLoop(store, taskId, { adapters: defaultAdapters(), hooks, workerMcpConfig: process.env.ORCH_WORKER_MCP_CONFIG, jobrunExe: jr.exe,
    // r3.1 F3: Windows ma jobrun khong dung duoc (khong phai do nguoi dung tat) -> envelope co warnings jobrun_unavailable
    jobrunUnavailableReason: !jr.exe && process.platform === 'win32' && process.env.ORCH_JOBRUN !== '0' ? jr.error : null }, { log });
  await flushToasts(8000); // toast la con KHONG detached cua runner -> doi no hien xong roi moi thoat
  process.exit(0);
} catch (e) {
  fatal(e?.code === 'lease_permission' ? e.message : `LOI: ${e?.stack ?? e}`);
  killActiveChildren();
  process.exit(1);
}
