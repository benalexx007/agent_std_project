// Tien trinh tren Windows:
//  - resolveCommand: chi nhan file co duoi PATHEXT (B1: shim npm khong duoi la script sh -> ENOENT).
//  - shim npm .cmd: doc shim lay entry JS/EXE roi chay truc tiep, KHONG qua cmd.exe (B17).
//  - neu buoc phai qua cmd.exe: escape theo thuat toan cross-spawn (^ + double-escape cho .cmd), tu choi doi so chua xuong dong.
//  - killTree, pidAlive, procCreationTime (xac thuc pid truoc khi kill - B10), processAncestry (chong de quy - B9).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { wrapWithJobrun } from './jobrun.mjs';

const isWin = process.platform === 'win32';

/** Tim duong dan thuc cua lenh. Tren Windows chi nhan file co duoi trong PATHEXT, theo thu tu PATHEXT. */
export function resolveCommand(cmd, env = process.env) {
  const pathext = (env.PATHEXT ?? env.Pathext ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase());
  const hasExt = isWin && pathext.includes(path.extname(cmd).toLowerCase());
  const candidates = (base) => (!isWin ? [base] : hasExt ? [base] : pathext.map((e) => base + e));
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    return candidates(cmd).find(isFile) ?? null;
  }
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const c of candidates(path.join(d, cmd))) if (isFile(c)) return c;
  return null;
}

/**
 * Doc shim .cmd do npm (cmd-shim) sinh ra de lay dich that.
 * Dang thuong gap: "%dp0%\node_modules\@openai\codex\bin\codex.js" %*   hoac  "%~dp0\node_modules\...\claude.exe" %*
 * @returns {{kind:'js'|'exe', target:string} | null}
 */
export function parseNpmCmdShim(cmdPath) {
  let text;
  try { text = fs.readFileSync(cmdPath, 'utf8'); } catch { return null; }
  const dir = path.dirname(cmdPath);
  const re = /"%~?dp0%?\\?([^"]+?\.(js|cjs|mjs|exe))"\s+%\*/gi;
  let m; let last = null;
  while ((m = re.exec(text))) last = m;
  if (!last) return null;
  const target = path.resolve(dir, last[1]);
  if (!fs.existsSync(target)) return null;
  return { kind: /\.exe$/i.test(target) ? 'exe' : 'js', target };
}

// ---- escape cho cmd.exe (theo cross-spawn/lib/util/escape.js) ----
const META = /([()\][%!^"`<>&|;, *?])/g;
export function escapeCmdCommand(s) { return s.replace(META, '^$1'); }
export function escapeCmdArgument(arg, doubleEscape) {
  let a = `${arg}`;
  if (/[\r\n]/.test(a)) throw new Error('doi so chua xuong dong khong the truyen an toan qua cmd.exe');
  a = a.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  a = a.replace(/(?=(\\+?)?)\1$/, '$1$1');
  a = `"${a}"`;
  a = a.replace(META, '^$1');
  if (doubleEscape) a = a.replace(META, '^$1');
  return a;
}

/**
 * Tinh ke hoach goi lenh (tach rieng de test duoc ma khong spawn).
 * @returns {{file:string, args:string[], verbatim:boolean, via:'direct'|'node-shim'|'exe-shim'|'cmd'|'powershell'}}
 */
export function planSpawn(command, args, env = process.env) {
  if (!isWin || command === process.execPath) return { file: command, args, verbatim: false, via: 'direct' };
  const resolved = resolveCommand(command, env);
  if (!resolved) {
    const err = new Error(`ENOENT: khong tim thay lenh '${command}' (PATH/PATHEXT)`);
    err.code = 'ENOENT';
    throw err;
  }
  if (/\.(cmd|bat)$/i.test(resolved)) {
    const shim = parseNpmCmdShim(resolved);
    if (shim?.kind === 'js') return { file: process.execPath, args: [shim.target, ...args], verbatim: false, via: 'node-shim' };
    if (shim?.kind === 'exe') return { file: shim.target, args, verbatim: false, via: 'exe-shim' };
    const line = [escapeCmdCommand(resolved), ...args.map((a) => escapeCmdArgument(a, true))].join(' ');
    return { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true, via: 'cmd' };
  }
  if (/\.ps1$/i.test(resolved)) {
    // N8 (r3): KHONG goi `powershell -File` (Q6: 5/10 ca sai - PowerShell 5.1 nuot dau " trong doi so khi chuyen cho exe,
    // bo doi so rong). Thay vao do: (a) shim npm .ps1 -> doc dich JS/EXE va chay truc tiep; (b) .cmd/.exe cung ten canh do;
    // (c) con lai -> loi config ro rang.
    const shim = parseNpmPs1Shim(resolved);
    if (shim?.kind === 'js') return { file: process.execPath, args: [shim.target, ...args], verbatim: false, via: 'node-shim' };
    if (shim?.kind === 'exe') return { file: shim.target, args, verbatim: false, via: 'exe-shim' };
    const base = resolved.slice(0, -4);
    for (const ext of ['.exe', '.cmd']) {
      if (fs.existsSync(base + ext)) return planSpawn(base + ext, args, env);
    }
    const err = new Error(`'${resolved}' la script PowerShell khong phai shim npm; khong ho tro (doi so qua powershell -File khong an toan). Dat ORCH_*_CMD toi .exe/.cmd`);
    err.code = 'ENOENT';
    throw err;
  }
  return { file: resolved, args, verbatim: false, via: 'direct' };
}

/** Shim .ps1 cua cmd-shim: `& "$basedir/node$exe"  "$basedir/node_modules/.../cli.js" $args` hoac `& "$basedir/.../x.exe" $args`. */
export function parseNpmPs1Shim(ps1Path) {
  let text;
  try { text = fs.readFileSync(ps1Path, 'utf8'); } catch { return null; }
  const re = /"\$basedir[\\/]([^"$]+?\.(js|cjs|mjs|exe))"/gi;
  let m; let last = null;
  while ((m = re.exec(text))) last = m;
  if (!last) return null;
  const target = path.resolve(path.dirname(ps1Path), last[1]);
  if (!fs.existsSync(target)) return null;
  return { kind: /\.exe$/i.test(target) ? 'exe' : 'js', target };
}

/**
 * Chay backend. Prompt va du lieu lon KHONG di qua argv (di qua stdin hoac file).
 * r3 (N5): neu co inv.jobrunExe (Windows) -> boc bang jobrun.exe: moi hau due cua backend nam trong job KILL_ON_JOB_CLOSE rieng.
 */
export function spawnInvocation(inv) {
  const env = { ...process.env, ...(inv.env ?? {}) };
  let p = planSpawn(inv.command, inv.args, env);
  if (isWin && inv.jobrunExe) {
    p = wrapWithJobrun(inv.jobrunExe, p);
    env.ORCH_JOBRUN_PARENT = String(process.pid);
  }
  const child = spawn(p.file, p.args, {
    cwd: inv.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !isWin,
    windowsVerbatimArguments: p.verbatim, ...(p.argv0 ? { argv0: p.argv0 } : {}),
  });
  child.via = p.via;
  return child;
}

/** Kill ca cay tien trinh. */
export function killTree(pid, { graceful = false } = {}) {
  if (!pid) return;
  if (isWin) {
    // r3: co timeout - taskkill /T duyet cay qua WMI va co the treo khi WMI qua tai (openai/codex #34260)
    spawnSync('taskkill', ['/PID', String(pid), '/T', ...(graceful ? [] : ['/F'])], { windowsHide: true, stdio: 'ignore', timeout: 10_000 });
  } else {
    try { process.kill(-pid, graceful ? 'SIGINT' : 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function powershell(script, timeout = 15000) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, encoding: 'utf8', timeout });
  return r.status === 0 ? r.stdout : null;
}

/** Thoi diem tao tien trinh (ms epoch) hoac null. Dung de xac thuc pid truoc khi kill (chong PID reuse). */
export function procCreationTime(pid) {
  if (!pidAlive(pid)) return null;
  if (!isWin) {
    try { return fs.statSync(`/proc/${pid}`).ctimeMs; } catch { return null; }
  }
  const out = powershell(`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if($p){$p.CreationDate.ToUniversalTime().ToString('o')}`);
  const t = out ? Date.parse(out.trim()) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** Danh sach to tien cua mot pid (gan nhat truoc). Windows: 1 truy van CIM (~0.5-1s). */
export function processAncestry(pid = process.pid) {
  let pairs = [];
  if (isWin) {
    const out = powershell("Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }", 20000);
    if (!out) return [];
    pairs = out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number)).filter((p) => p.length === 2);
  } else {
    try {
      for (const d of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue;
        try { const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); const ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]); pairs.push([Number(d), ppid]); } catch {}
      }
    } catch { return []; }
  }
  const parent = new Map(pairs);
  const chain = [];
  const seen = new Set();
  let cur = parent.get(pid);
  while (cur && !seen.has(cur) && chain.length < 64) { chain.push(cur); seen.add(cur); cur = parent.get(cur); }
  return chain;
}

export function runPowershell(script, timeout) { return powershell(script, timeout); }

// ---- N13 (r3): ban BAT DONG BO - MCP server/hub khong chan event loop ~1s moi lan truy van CIM ----
export function powershellAsync(script, timeout = 15000) {
  return new Promise((resolve) => {
    let out = '';
    let c;
    try {
      c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return resolve(null); }
    const t = setTimeout(() => { try { c.kill(); } catch {} resolve(null); }, timeout);
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', () => { clearTimeout(t); resolve(null); });
    c.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? out : null); });
  });
}

export async function processAncestryAsync(pid = process.pid) {
  if (!isWin) return processAncestry(pid);
  const out = await powershellAsync("Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }", 20000);
  if (!out) return [];
  const parent = new Map(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number)).filter((p) => p.length === 2));
  const chain = [];
  const seen = new Set();
  let cur = parent.get(pid);
  while (cur && !seen.has(cur) && chain.length < 64) { chain.push(cur); seen.add(cur); cur = parent.get(cur); }
  return chain;
}
