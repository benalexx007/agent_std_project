// `orch doctor` / tool subagent_doctor (C5, B11): chan doan moi truong ma KHONG chay backend nao.
//  1. phan giai lenh claude/codex/agy (B1/B17): duong dan, cach goi (node-shim | exe-shim | cmd | direct)
//  2. ORCH_HOME ghi + rename duoc khong (antivirus/OneDrive), do thoi gian
//  3. named pipe lease: listen / probe / listen trung -> loai tru
//  4. Job Object cua tien trinh runner (detached) trong NGU CANH HIEN TAI (chay qua MCP server = ngu canh cua GUI):
//     co trong job khong, LimitFlags (KILL_ON_JOB_CLOSE?), breakaway duoc khong
//  5. chuoi to tien (de biet GUI host nao dang chay hub)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { planSpawn, processAncestry, runPowershell } from './proc.mjs';
import { acquireLease, probeLease } from './lease.mjs';
import { sleep } from './fsutil.mjs';
import { ensureJobrun, detachedJobInfo } from './jobrun.mjs';

// Do job cua MOT tien trinh khac theo pid (IsProcessInJob(hProcess, NULL)).
// Ghi chu do dac r2: powershell.exe 5.1 khoi dong voi DETACHED_PROCESS thoat 0 ngay ma khong chay script (khong co console host),
// va powershell con KHONG detached nam trong job long cua libuv (LimitFlags 0x3C00) -> khong do duoc job cua host tu ben trong.
// Vi vay: spawn mot node detached (y het launcher runner) roi hoi tu ben ngoai xem pid do co thuoc job nao khong.
const JOB_PS = String.raw`
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class OrchJob {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool IsProcessInJob(IntPtr h, IntPtr job, out bool r);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr h, uint code);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct SI { public int cb; public string r, d, t; public int x, y, xs, ys, xc, yc, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hp, ht; public int pid, tid; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  // Thu tao tien trinh TREO (CREATE_SUSPENDED) voi CREATE_BREAKAWAY_FROM_JOB: thanh cong + khong thuoc job => host cho breakaway.
  public static string Breakaway() {
    SI si = new SI(); si.cb = Marshal.SizeOf(si); PI pi;
    string cmd = Environment.GetEnvironmentVariable("ComSpec") + " /c exit 0";
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x01000000 | 0x08000000 | 0x4, IntPtr.Zero, null, ref si, out pi)) return "denied:" + Marshal.GetLastWin32Error();
    bool r; IsProcessInJob(pi.hp, IntPtr.Zero, out r); TerminateProcess(pi.hp, 0); CloseHandle(pi.hp); CloseHandle(pi.ht);
    return r ? "still_in_job" : "ok";
  }
}
"@
$res = @{}
foreach ($p in ($env:ORCH_DOCTOR_PIDS -split ',')) {
  $h = [OrchJob]::OpenProcess(0x1000, $false, [int]$p)
  if ($h -eq [IntPtr]::Zero) { $res[$p] = $null; continue }
  $r = $false; [void][OrchJob]::IsProcessInJob($h, [IntPtr]::Zero, [ref]$r); [void][OrchJob]::CloseHandle($h)
  $res[$p] = $r
}
$res['breakaway'] = [OrchJob]::Breakaway()
$res | ConvertTo-Json -Compress
`;

async function jobInfoOfDetachedChild() {
  if (process.platform !== 'win32') return { skipped: 'khong phai Windows' };
  // Khoi dong GIONG launcher cua runner (node detached) de do dung moi truong runner se song.
  const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { detached: true, stdio: 'ignore', windowsHide: true });
  c.on('error', () => {});
  c.unref();
  try {
    await new Promise((r) => { c.once('spawn', r); c.once('error', r); });
    const out = runPowershell(JOB_PS.replace('$env:ORCH_DOCTOR_PIDS', `'${c.pid},${process.pid}'`), 20000);
    const j = out ? JSON.parse(out.trim()) : null;
    if (!j) return { error: 'khong doc duoc ket qua (powershell bi chan?)' };
    const runnerInJob = j[String(c.pid)];
    return {
      runner_in_job: runnerInJob, hub_in_job: j[String(process.pid)], breakaway: j.breakaway,
      // Do dac r2 tren Win11: ca tien trinh tao qua WMI Win32_Process.Create cung bao in_job=true -> "thuoc job" KHONG du de ket luan
      // runner se chet; chi in_job=false moi la bang chung tot. Kiem chung cuoi cung la thu cong (dong GUI khi task dang chay).
      verdict: runnerInJob === false ? 'runner (node detached) khong thuoc job nao -> song sot khi GUI dong'
        : runnerInJob === true ? 'runner thuoc mot job (tren Win11 thuong gap, ke ca tien trinh tao qua WMI) -> KHONG ket luan duoc; kiem tra thu cong: spawn task dai, dong GUI, mo lai, subagent_status phai thay runner_alive=true'
          : 'khong mo duoc tien trinh de kiem tra',
    };
  } finally {
    try { process.kill(c.pid); } catch {}
  }
}

/**
 * N12 (r3): LimitFlags cua job ma mot tien trinh DETACHED (giong launcher runner) roi vao. Do bang jobrun --jobinfo
 * (.NET console app chay duoc khi DETACHED_PROCESS; powershell 5.1 thi khong). Do tren may dev (ngu canh Claude Code):
 * {in_job:true, limit_flags:0, breakaway:'denied:5'} -> job KHONG co KILL_ON_JOB_CLOSE: dong handle job khong giet runner;
 * rui ro con lai chi la host chu dong TerminateJobObject (khong do duoc bang API - kiem tra thu cong).
 */
export function jobVerdict(info) {
  if (!info) return { ok: null, verdict: 'khong do duoc (jobrun khong chay / bi chan)' };
  if (!info.in_job) return { ok: true, verdict: 'runner detached khong thuoc job nao -> song sot khi GUI dong' };
  const f = Number(info.limit_flags ?? 0);
  if (f & 0x2000) return { ok: false, verdict: `job host co KILL_ON_JOB_CLOSE (LimitFlags 0x${f.toString(16)}) -> runner CHET khi host dong job; can breakaway (${info.breakaway}) hoac chay hub ngoai host` };
  return { ok: true, verdict: `job host khong co KILL_ON_JOB_CLOSE (LimitFlags 0x${f.toString(16)}) -> dong GUI khong tu giet runner; con rui ro host TerminateJobObject chu dong (kiem tra thu cong)` };
}
async function jobLimitsOfDetached(root) {
  if (process.platform !== 'win32') return { skipped: 'khong phai Windows' };
  const jr = ensureJobrun(root);
  if (!jr.exe) return { ok: null, error: jr.error };
  const info = await detachedJobInfo(jr.exe, path.join(root, `.doctor-jobinfo-${process.pid}.json`));
  try { fs.unlinkSync(path.join(root, `.doctor-jobinfo-${process.pid}.json`)); } catch {}
  return { ...(info ?? {}), ...jobVerdict(info) };
}

/** N11: bien moi truong ma hub/runner/backend can; thieu -> canh bao (khong loi cung). */
export function envCheck(env = process.env, platform = process.platform) {
  const need = platform === 'win32' ? ['LOCALAPPDATA', 'PATH', 'SystemRoot', 'USERPROFILE', 'PATHEXT', 'ComSpec'] : ['HOME', 'PATH'];
  const get = (k) => env[k] ?? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())];
  const missing = need.filter((k) => !get(k));
  return { ok: missing.length === 0 ? true : null, missing, orch_home_from: env.ORCH_HOME ? 'ORCH_HOME' : missing.includes('LOCALAPPDATA') ? 'USERPROFILE\\AppData\\Local (fallback)' : 'LOCALAPPDATA',
    hint: missing.length ? 'GUI chay MCP server voi env rut gon: dat ORCH_HOME (va PATH) trong cau hinh MCP server cho moi GUI giong nhau' : undefined };
}

function ancestryNames() {
  if (process.platform !== 'win32') return processAncestry().map((pid) => ({ pid }));
  const chain = processAncestry();
  if (!chain.length) return [];
  const out = runPowershell(`Get-CimInstance Win32_Process -Filter "${chain.map((p) => `ProcessId=${Number(p)}`).join(' OR ')}" | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`);
  const names = new Map((out ?? '').split(/\r?\n/).filter(Boolean).map((l) => { const [p, n] = l.trim().split('|'); return [Number(p), n]; }));
  return chain.map((pid) => ({ pid, name: names.get(pid) ?? null }));
}

export async function doctor(root, { backends = { claude: process.env.ORCH_CLAUDE_CMD ?? 'claude', codex: process.env.ORCH_CODEX_CMD ?? 'codex', antigravity: process.env.ORCH_ANTIGRAVITY_CMD ?? 'agy' } } = {}) {
  const report = { node: process.version, platform: process.platform, orch_home: root, checks: {} };
  // 1. phan giai lenh (KHONG chay)
  report.checks.commands = {};
  for (const [b, cmd] of Object.entries(backends)) {
    try { const p = planSpawn(cmd, []); report.checks.commands[b] = { ok: true, via: p.via, file: p.file, entry: p.args[0] ?? null }; }
    catch (e) { report.checks.commands[b] = { ok: false, error: e.message }; }
  }
  // 2. ORCH_HOME ghi + rename
  try {
    fs.mkdirSync(root, { recursive: true });
    const t0 = Date.now();
    const a = path.join(root, `.doctor-${process.pid}.tmp`);
    const b = path.join(root, `.doctor-${process.pid}.json`);
    for (let i = 0; i < 20; i++) { fs.writeFileSync(a, String(i)); fs.renameSync(a, b); }
    fs.unlinkSync(b);
    report.checks.store = { ok: true, ms_per_write_rename: (Date.now() - t0) / 20 };
  } catch (e) { report.checks.store = { ok: false, error: e.message }; }
  // 3. named pipe
  try {
    const l = await acquireLease(root, `doctor-${process.pid}`);
    const second = await acquireLease(root, `doctor-${process.pid}`);
    const p = await probeLease(root, `doctor-${process.pid}`);
    await l.release();
    const after = await probeLease(root, `doctor-${process.pid}`);
    report.checks.lease = { ok: !!l && !second && p.alive === true && after.alive === false, exclusive: !second, probe_alive: p.alive, after_release: after.alive };
    if (second) await second.release();
  } catch (e) { report.checks.lease = { ok: false, error: e.message }; }
  // 4. job object (r2: node detached co thuoc job khong) + r3 (N12): LimitFlags CUA CHINH job do, doc tu ben trong
  report.checks.job = await jobInfoOfDetachedChild();
  report.checks.job_limits = await jobLimitsOfDetached(root);
  // 4b. jobrun (N5): bien dich duoc khong -> backend co job KILL_ON_JOB_CLOSE rieng
  if (process.platform === 'win32') {
    const jr = ensureJobrun(root);
    // r3.1 (F3): exe da TU KIEM (chay that cmd /c exit 7 qua jobrun); hong/bi chan -> runner chay thang (jobrun_unavailable)
    report.checks.jobrun = jr.exe ? { ok: true, exe: jr.exe, exec_ok: jr.exec_ok === true, compiled_ms: jr.compiled_ms ?? 0 }
      : { ok: false, exec_ok: false, error: jr.error, effect: 'backend chay THANG khong qua job rieng (jobrun_unavailable): tien trinh nen cua backend co the song sot khi huy' };
  }
  // 4d. r3.1 (F4): muc subagent-hub trong config Codex -> worker Codex se duoc tat dung cac muc nay bang -c ...enabled=false
  try {
    const { codexHubEntries } = await import('./adapters/codex.mjs');
    const h = codexHubEntries({ cwd: process.cwd() });
    report.checks.codex_hub = { ok: h.skipped.length === 0, disabled_for_workers: h.names, files: h.files,
      ...(h.skipped.length ? { skipped: h.skipped, effect: 'ten muc khong phai bare key -> khong tat duoc qua -c; doi ten muc thanh [A-Za-z0-9_-]' } : {}),
      note: h.names.length ? undefined : 'config Codex khong co muc tro toi mcp-server.mjs -> worker Codex khong nap hub (khong them -c)' };
  } catch (e) { report.checks.codex_hub = { ok: null, error: e.message }; }
  // 4c. env (N11): GUI co the chay MCP server voi env rut gon
  report.checks.env = envCheck();
  // 5. to tien
  try { report.checks.ancestry = ancestryNames(); } catch (e) { report.checks.ancestry = { error: e.message }; }
  report.ok = Object.values(report.checks).every((c) => !c || c.ok !== false) && Object.values(report.checks.commands).some((c) => c.ok);
  report.note = 'doctor KHONG chay backend. Kiem tra them bang tay: spawn task dai, dong GUI, mo lai -> subagent_status phai thay runner_alive=true.';
  return report;
}
