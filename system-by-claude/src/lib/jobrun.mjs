// jobrun.exe (N5/D4 r3): bo boc dat backend vao MOT Job Object rieng KILL_ON_JOB_CLOSE, khong cho breakaway.
//
// Van de (Q10, do r2): job cua libuv co JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK (LimitFlags 0x3C00) -> "chau" cua backend
// (vd tool chay `start /b`) tu thoat khoi job, song sot sau taskkill /T /F va sau khi runner thoat.
// Cach lam: runner -> jobrun.exe -> backend. jobrun tao job J (KILL_ON_JOB_CLOSE, KHONG BREAKAWAY_OK/SILENT_BREAKAWAY_OK),
// tao backend CREATE_SUSPENDED, gan vao J, ResumeThread, cho, tra nguyen exit code. Moi hau due cua backend nam trong J.
// jobrun chet (taskkill, TerminateProcess, runner chet keo theo) -> handle J dong -> OS kill toan bo J.
// jobrun cung canh cha (ORCH_JOBRUN_PARENT): runner chet cung -> TerminateJobObject (khong de mo coi cho runner sau).
//
// Bien dich: chi dung thanh phan san co cua Windows (PowerShell 5.1 Add-Type -> csc cua .NET Framework 4),
// KHONG them dependency npm. Cache theo hash nguon trong <ORCH_HOME>/bin/jobrun-<hash>.exe. Do tren may dev: xem docs/05.
// Dong lenh: runner tu dung dong lenh cua backend (quote theo dung thuat toan libuv) va dat SAU argv0 da quote cua jobrun;
// jobrun lay phan duoi cua GetCommandLineW nguyen van -> backend nhan dung dong lenh nhu khi spawn truc tiep.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const JOBRUN_CS = String.raw`
using System;
using System.Runtime.InteropServices;
public static class JobRun {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI { public int cb; public string r, d, t; public int x, y, xs, ys, xc, yc, fill, flags; public short show, r2; public IntPtr r3, i, o, e; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hp, ht; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
  [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IOC Io; public UIntPtr p, j, pp, jp; }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j, int cls, ref EXT info, int len);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr j, uint code);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr h, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForMultipleObjects(uint n, IntPtr[] h, bool all, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetCommandLineW();
  // r3.1 (M9/R6): PROC_THREAD_ATTRIBUTE_JOB_LIST (Win10 1607+) gan job NGAY luc tao tien trinh -> khong con cua so
  // giua CREATE_SUSPENDED va AssignProcessToJobObject. Loi (Windows cu) -> lui ve SUSPENDED + Assign nhu r3.
  [StructLayout(LayoutKind.Sequential)] struct SIEX { public SI si; public IntPtr attr; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr l, int n, int f, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr l, uint f, IntPtr attr, IntPtr val, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode, EntryPoint="CreateProcessW")] static extern bool CreateProcessEx(string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref SIEX si, out PI pi);

  static string Tail(string cl) {
    int i = 0;
    if (cl.Length > 0 && cl[0] == '"') { i = cl.IndexOf('"', 1); i = i < 0 ? cl.Length : i + 1; }
    else { while (i < cl.Length && cl[i] != ' ' && cl[i] != '\t') i++; }
    while (i < cl.Length && (cl[i] == ' ' || cl[i] == '\t')) i++;
    return cl.Substring(i);
  }
  static int Fail(string m, int code) { Console.Error.WriteLine("[jobrun] " + m); return code; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j, int cls, ref EXT info, int len, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();

  // N12 (doctor): "--jobinfo <file>" -> ghi JSON ve job MA CHINH TIEN TRINH NAY dang o (khoi dong detached giong runner).
  // .NET console app chay duoc khi DETACHED_PROCESS (khac powershell 5.1, thoat ngay khi khong co console).
  static int JobInfo(string file) {
    bool inJob; IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inJob);
    string flags = "null";
    if (inJob) { EXT e = new EXT(); if (QueryInformationJobObject(IntPtr.Zero, 9, ref e, Marshal.SizeOf(typeof(EXT)), IntPtr.Zero)) flags = e.Basic.LimitFlags.ToString(); }
    SI si = new SI(); si.cb = Marshal.SizeOf(typeof(SI)); PI pi;
    // r3.1 (M8-d): khong dung ComSpec (thieu ComSpec -> "denied:87" gia); System32 lay tu he thong, khong tu env
    string cmd = "\"" + Environment.SystemDirectory + "\\cmd.exe\" /c exit 0";
    string brk;
    if (!CreateProcess(null, new System.Text.StringBuilder(cmd, cmd.Length + 1), IntPtr.Zero, IntPtr.Zero, false, 0x01000000 | 0x08000000 | 0x4, IntPtr.Zero, null, ref si, out pi)) brk = "denied:" + Marshal.GetLastWin32Error();
    else { bool r; IsProcessInJob(pi.hp, IntPtr.Zero, out r); TerminateProcess(pi.hp, 0); brk = r ? "still_in_job" : "ok"; }
    System.IO.File.WriteAllText(file, "{\"in_job\":" + (inJob ? "true" : "false") + ",\"limit_flags\":" + flags + ",\"breakaway\":\"" + brk + "\"}");
    return 0;
  }

  public static int Main() {
    string tail = Tail(Marshal.PtrToStringUni(GetCommandLineW()));
    if (tail.Length == 0) return Fail("thieu dong lenh", 120);
    if (tail.StartsWith("--jobinfo ")) return JobInfo(tail.Substring(10).Trim().Trim('"'));
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return Fail("CreateJobObject loi " + Marshal.GetLastWin32Error(), 121);
    EXT ext = new EXT();
    ext.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE; KHONG co BREAKAWAY_OK (0x800) / SILENT_BREAKAWAY_OK (0x1000)
    if (!SetInformationJobObject(job, 9, ref ext, Marshal.SizeOf(typeof(EXT)))) return Fail("SetInformationJobObject loi " + Marshal.GetLastWin32Error(), 122);
    SI si = new SI(); si.cb = Marshal.SizeOf(typeof(SI));
    si.flags = 0x100; // STARTF_USESTDHANDLES: backend dung dung pipe stdin/stdout/stderr cua runner
    si.i = GetStdHandle(-10); si.o = GetStdHandle(-11); si.e = GetStdHandle(-12);
    foreach (IntPtr h in new IntPtr[] { si.i, si.o, si.e }) if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, 1, 1);
    PI pi = new PI();
    bool created = false;
    IntPtr size = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    IntPtr al = size == IntPtr.Zero ? IntPtr.Zero : Marshal.AllocHGlobal(size);
    IntPtr box = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(box, job);
    if (al != IntPtr.Zero && Environment.GetEnvironmentVariable("ORCH_JOBRUN_NO_JOBLIST") != "1"
        && InitializeProcThreadAttributeList(al, 1, 0, ref size)
        && UpdateProcThreadAttribute(al, 0, new IntPtr(0x2000D), box, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) {
      SIEX sx = new SIEX(); sx.si = si; sx.si.cb = Marshal.SizeOf(typeof(SIEX)); sx.attr = al;
      // EXTENDED_STARTUPINFO_PRESENT (0x80000): backend nam trong job tu truoc lenh dau tien
      if (CreateProcessEx(null, new System.Text.StringBuilder(tail, tail.Length + 1), IntPtr.Zero, IntPtr.Zero, true, 0x80000, IntPtr.Zero, null, ref sx, out pi)) created = true;
      else {
        int err = Marshal.GetLastWin32Error();
        if (err == 2 || err == 3) return Fail("CreateProcess loi " + err + " (ENOENT)", 127);
      }
    }
    if (!created) {
      // CREATE_SUSPENDED: gan vao job TRUOC khi backend chay dong lenh nao -> khong co khe ho cho chau thoat.
      if (!CreateProcess(null, new System.Text.StringBuilder(tail, tail.Length + 1), IntPtr.Zero, IntPtr.Zero, true, 0x4, IntPtr.Zero, null, ref si, out pi)) {
        int err = Marshal.GetLastWin32Error();
        return Fail("CreateProcess loi " + err + (err == 2 || err == 3 ? " (ENOENT)" : ""), err == 2 || err == 3 ? 127 : 126);
      }
      if (!AssignProcessToJobObject(job, pi.hp)) {
        int err = Marshal.GetLastWin32Error();
        TerminateProcess(pi.hp, 1);
        return Fail("AssignProcessToJobObject loi " + err, 123);
      }
      ResumeThread(pi.ht);
    }
    // r3.1 (M9): test/doctor biet duong nao duoc dung (prefix khac "[jobrun]" -> khong bi coi la loi jobrun)
    if (Environment.GetEnvironmentVariable("ORCH_JOBRUN_DEBUG") == "1") Console.Error.WriteLine("[jobrun-debug] " + (created ? "joblist" : "suspended"));
    IntPtr parent = IntPtr.Zero;
    string pp = Environment.GetEnvironmentVariable("ORCH_JOBRUN_PARENT");
    int ppid;
    if (!String.IsNullOrEmpty(pp) && Int32.TryParse(pp, out ppid)) parent = OpenProcess(0x00100000, false, ppid); // SYNCHRONIZE
    IntPtr[] hs = parent != IntPtr.Zero ? new IntPtr[] { pi.hp, parent } : new IntPtr[] { pi.hp };
    uint w = WaitForMultipleObjects((uint)hs.Length, hs, false, 0xFFFFFFFF);
    if (w == 1) { TerminateJobObject(job, 1); return 137; } // runner (cha) chet -> keo theo ca job
    uint code; GetExitCodeProcess(pi.hp, out code);
    // backend thoat: chau con sot trong job cung bi kill khi jobrun thoat (KILL_ON_JOB_CLOSE) - dung y do.
    return unchecked((int)code);
  }
}
`;

export const JOBRUN_HASH = crypto.createHash('sha256').update(JOBRUN_CS).digest('hex').slice(0, 12);

/** Quote mot doi so theo DUNG thuat toan libuv quote_cmd_arg (ma node dung khi spawn truc tiep). */
export function quoteArg(a) {
  const s = String(a);
  if (s === '') return '""';
  if (!/[ \t"]/.test(s)) return s;
  if (!/["\\]/.test(s)) return `"${s}"`;
  let out = '"';
  let bs = 0;
  for (const ch of s) {
    if (ch === '\\') { bs++; continue; }
    if (ch === '"') { out += '\\'.repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += '\\'.repeat(bs) + ch;
    bs = 0;
  }
  return out + '\\'.repeat(bs * 2) + '"';
}

const _cache = new Map();
const BAD_TTL_MS = 24 * 3600_000;
const sysDir = (...p) => path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', ...p);
// r3.1 (M8-b): duong dan tuyet doi, khong phu thuoc PATH rut gon cua GUI
const psExe = () => { const p = sysDir('WindowsPowerShell', 'v1.0', 'powershell.exe'); return fs.existsSync(p) ? p : 'powershell.exe'; };
const cmdExe = () => { const p = sysDir('cmd.exe'); return fs.existsSync(p) ? p : (process.env.ComSpec || 'cmd.exe'); };
const sidecar = (exe, kind) => exe.replace(/\.exe$/i, `.${kind}`);

/**
 * r3.1 (F3/M3): danh dau jobrun hong (.bad, TTL 24h) -> moi runner sau KHONG thu lai exe nay; ensureJobrun tra exe:null.
 * Goi tu runner khi spawn jobrun loi (EFTYPE/EACCES/EPERM/UNKNOWN/ENOENT) hoac loi noi bo 120-123, va tu ensureJobrun.
 */
export function markJobrunBad(exe, reason) {
  if (!exe) return;
  try { fs.writeFileSync(sidecar(exe, 'bad'), JSON.stringify({ at: Date.now(), reason: String(reason).slice(0, 500) })); } catch {}
  try { fs.unlinkSync(sidecar(exe, 'ok')); } catch {}
  _cache.set(exe, { exe: null, exec_ok: false, error: `jobrun_unavailable: ${reason}` });
}
function readBad(exe) {
  try { const b = JSON.parse(fs.readFileSync(sidecar(exe, 'bad'), 'utf8')); if (Date.now() - b.at < BAD_TTL_MS) return b; } catch {}
  return null;
}
function okMatches(exe) {
  try { const o = JSON.parse(fs.readFileSync(sidecar(exe, 'ok'), 'utf8')); const st = fs.statSync(exe); return o.size === st.size && o.mtimeMs === st.mtimeMs; } catch { return false; }
}
function writeOk(exe) {
  try { const st = fs.statSync(exe); fs.writeFileSync(sidecar(exe, 'ok'), JSON.stringify({ at: Date.now(), size: st.size, mtimeMs: st.mtimeMs })); } catch {}
}

/** r3.1 (F3): chay THAT jobrun -> cmd /c exit 7 qua dung duong runner dung (job + JOB_LIST + std handle); dat khi exit 7. */
export function smokeJobrun(exe) {
  const r = spawnSync(exe, [`${quoteArg(cmdExe())} /d /c exit 7`], { windowsVerbatimArguments: true, argv0: `"${exe}"`,
    windowsHide: true, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { ok: false, error: `spawn ${r.error.code ?? ''}: ${r.error.message}` };
  if (r.status !== 7) return { ok: false, error: `tu kiem: exit ${r.status} (mong doi 7) ${(r.stderr || '').trim().slice(0, 200)}` };
  return { ok: true };
}

/**
 * Tra duong dan jobrun.exe DA TU KIEM (bien dich neu chua co) hoac exe:null (khong phai Windows / bi tat / hong / bi chan).
 * KHONG BAO GIO nem loi (r3.1 F5). An toan khi nhieu runner cung bien dich: file tam rieng roi rename; ben thua bo qua.
 * @returns {{exe: string|null, error?: string, compiled_ms?: number, exec_ok?: boolean}}
 */
export function ensureJobrun(root) {
  try { return ensureJobrunUnsafe(root); } catch (e) { return { exe: null, exec_ok: false, error: `ensureJobrun loi: ${e.code ?? ''} ${e.message}` }; }
}

function ensureJobrunUnsafe(root) {
  if (process.platform !== 'win32') return { exe: null, error: 'khong phai Windows' };
  if (process.env.ORCH_JOBRUN === '0') return { exe: null, error: 'ORCH_JOBRUN=0' };
  const binDir = path.join(root, 'bin');
  const exe = path.join(binDir, `jobrun-${JOBRUN_HASH}.exe`);
  if (_cache.has(exe)) return _cache.get(exe);
  const done = (r) => { _cache.set(exe, r); return r; };
  const bad = readBad(exe);
  if (bad) return done({ exe: null, exec_ok: false, error: `jobrun bi danh dau hong luc ${new Date(bad.at).toISOString()}: ${bad.reason} (xoa ${sidecar(exe, 'bad')} de thu lai)` });
  if (fs.existsSync(exe)) {
    if (okMatches(exe)) return done({ exe, exec_ok: true });
    const sm = smokeJobrun(exe);
    if (sm.ok) { writeOk(exe); return done({ exe, exec_ok: true }); }
    // exe trong cache hong (0 byte, AV cat) -> xoa va bien dich lai MOT lan; van hong -> .bad
    try { fs.unlinkSync(exe); } catch {}
    if (fs.existsSync(exe)) { markJobrunBad(exe, sm.error); return _cache.get(exe); }
  }
  fs.mkdirSync(binDir, { recursive: true });
  const tmpExe = path.join(binDir, `jobrun-${JOBRUN_HASH}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.exe`);
  const csFile = tmpExe.replace(/\.exe$/, '.cs');
  fs.writeFileSync(csFile, JOBRUN_CS);
  const ps = `$ErrorActionPreference='Stop'; Add-Type -Path $env:JR_CS -OutputAssembly $env:JR_OUT -OutputType ConsoleApplication`;
  const t0 = Date.now();
  const r = spawnSync(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { windowsHide: true, encoding: 'utf8', timeout: 60_000, env: { ...process.env, JR_CS: csFile, JR_OUT: tmpExe } });
  try { fs.unlinkSync(csFile); } catch {}
  if (r.status !== 0 || !fs.existsSync(tmpExe)) {
    try { fs.unlinkSync(tmpExe); } catch {}
    markJobrunBad(exe, `bien dich jobrun loi: ${(r.stderr || r.error?.message || '').trim().slice(0, 400)}`); // M8-c: negative cache tren dia
    return _cache.get(exe);
  }
  try { fs.renameSync(tmpExe, exe); } catch { try { fs.unlinkSync(tmpExe); } catch {} }
  if (!fs.existsSync(exe)) return done({ exe: null, error: 'khong rename duoc jobrun' });
  const compiled_ms = Date.now() - t0;
  if (okMatches(exe)) return done({ exe, compiled_ms, exec_ok: true }); // tien trinh khac vua tu kiem xong
  const sm = smokeJobrun(exe);
  if (!sm.ok) { markJobrunBad(exe, sm.error); return _cache.get(exe); }
  writeOk(exe);
  return done({ exe, compiled_ms, exec_ok: true });
}

/** Chi dung trong test/probe: quen cache trong tien trinh. */
export function _resetJobrunCache() { _cache.clear(); }

/**
 * N12: chay jobrun --jobinfo DETACHED (cung co nhu launcher cua runner) -> LimitFlags cua job ma tien trinh detached roi vao.
 * KILL_ON_JOB_CLOSE = 0x2000; BREAKAWAY_OK = 0x800; SILENT_BREAKAWAY_OK = 0x1000.
 */
export async function detachedJobInfo(exe, outFile, { timeoutMs = 10_000 } = {}) {
  const { spawn } = await import('node:child_process');
  try { fs.unlinkSync(outFile); } catch {}
  const c = spawn(exe, [`--jobinfo "${outFile}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, argv0: `"${exe}"` });
  c.on('error', () => {});
  c.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { return JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Boc ke hoach spawn {file,args,verbatim} bang jobrun: node spawn jobrun voi argv0 da quote + dong lenh backend nguyen van.
 * @returns {{file:string, args:string[], verbatim:true, argv0:string, via:string}}
 */
export function wrapWithJobrun(exe, plan) {
  const tail = plan.verbatim
    ? [quoteArg(plan.file), ...plan.args].join(' ')
    : [quoteArg(plan.file), ...plan.args.map(quoteArg)].join(' ');
  return { file: exe, args: [tail], verbatim: true, argv0: `"${exe}"`, via: `jobrun+${plan.via}`, inner: plan };
}
