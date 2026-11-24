// Lease do HE DIEU HANH giu (B3): moi task/slot la mot named pipe (Windows) / abstract unix socket (Linux).
//  - Loai tru: listen lan 2 cung ten -> EADDRINUSE (Windows: FILE_FLAG_FIRST_PIPE_INSTANCE cua libuv).
//  - Liveness: tien trinh chet -> OS dong handle -> connect tra ENOENT/ECONNREFUSED. Khong pid, khong dong ho, khong heartbeat.
//  - Kenh "poke": hub connect vao pipe -> runner doc lai control/ ngay (cancel/followup tuc thoi), nhan lai info JSON.
// macOS/BSD (khong co abstract socket): socket file + connect-probe; con mot cua so race nho khi hai ben cung don socket chet
// (ghi trong docs muc rui ro; muc tieu chinh cua ban nay la Windows).
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

export function leaseName(root, name) {
  const h = crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
  const safe = String(name).replace(/[^A-Za-z0-9_.-]/g, '_');
  if (isWin) return `\\\\.\\pipe\\orch-${h}-${safe}`;
  if (isLinux) return `\0orch-${h}-${safe}`;
  return path.join(os.tmpdir(), `orch-${h}-${safe}.sock`);
}

function listenOnce(addr, onConn) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onConn);
    server.once('error', reject);
    server.listen(addr, () => { server.removeListener('error', reject); server.on('error', () => {}); resolve(server); });
  });
}

/**
 * r3.1 (F1/M1): phan loai loi pipe O MOT CHO cho ca listen (acquire) lan connect (probe).
 *  - 'held'    : listen EADDRINUSE. Tren Windows libuv anh xa ca ERROR_ACCESS_DENIED cua CreateNamedPipeW thanh EADDRINUSE
 *                (do J4 cua phan bien) -> listen KHONG phan biet duoc "dang co nguoi giu" voi "pipe cua tien trinh khac quyen";
 *                phai probe them de biet.
 *  - 'foreign' : connect EPERM/EACCES -> pipe ton tai nhung do tien trinh khac quyen (elevated / user khac) tao.
 *  - 'busy'    : EBUSY/EAGAIN/ETIMEDOUT -> co nguoi giu nhung moi instance dang ban.
 *  - 'dead'    : con lai (ENOENT, ECONNREFUSED...) -> khong ai giu.
 */
export function classifyPipeError(code) {
  if (code === 'EADDRINUSE') return 'held';
  if (code === 'EPERM' || code === 'EACCES') return 'foreign';
  if (code === 'EBUSY' || code === 'EAGAIN' || code === 'ETIMEDOUT') return 'busy';
  return 'dead';
}

/** N7: phan loai loi listen -> 'held' (co nguoi giu) hoac NEM loi (EACCES -> code 'lease_permission'). Tach rieng de test. */
export function listenErrorAction(e, addr = '') {
  if (e?.code === 'EADDRINUSE') return 'held';
  if (e?.code === 'EACCES') {
    throw Object.assign(new Error(`lease_permission: khong mo duoc ${addr} (EACCES) - pipe do tien trinh khac quyen (elevated/user khac) giu hoac bi chinh sach chan`), { code: 'lease_permission', cause: e });
  }
  throw e;
}

/**
 * Chiem lease. Tra ve null neu dang co nguoi giu.
 * @param {string} root
 * @param {string} name
 * @param {{info?: () => object, onPoke?: (msg: object|null) => void}} o
 * @returns {Promise<{release: () => Promise<void>, addr: string} | null>}
 */
export async function acquireLease(root, name, o = {}) {
  const addr = leaseName(root, name);
  const onConn = (sock) => {
    sock.on('error', () => {});
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let msg = null;
      try { msg = JSON.parse(buf.slice(0, i)); } catch {}
      try { o.onPoke?.(msg); } catch {}
      let info = {};
      try { info = o.info?.() ?? {}; } catch {}
      sock.end(JSON.stringify({ ok: true, ...info }) + '\n');
    });
  };
  for (let i = 0; i < 2; i++) {
    try {
      const server = await listenOnce(addr, onConn);
      return {
        addr,
        release: () => new Promise((r) => server.close(() => r())),
      };
    } catch (e) {
      // N7 (r3): EACCES KHONG phai "dang co nguoi giu". Tren Windows la pipe cung ten do user/integrity khac tao, hoac bi
      // chinh sach chan -> neu tra null, runner im lang thoat va hub tu chua relaunch mai. Nem loi co ma ro rang;
      // runner-main ghi runner.fatal.json -> hub tra status runner_failed.
      if (listenErrorAction(e, addr) === 'held' && (isWin || isLinux)) return null;
      // socket file: chi don khi khong ai tra loi
      const p = await probeLease(root, name, { timeoutMs: 500 });
      if (p.alive) return null;
      try { fs.unlinkSync(addr); } catch {}
    }
  }
  return null;
}

/**
 * Hoi lease: {alive:true, info} | {alive:false} | {alive:'unresponsive'} (co nguoi giu nhung khong tra loi kip)
 *           | {alive:'foreign', code} (r3.1: pipe do tien trinh khac quyen giu; khong tu chua duoc).
 * Gui kem `msg` (vd {"poke":"cancel"}) de danh thuc runner.
 */
export function probeLease(root, name, { timeoutMs = 1500, msg = { poke: 'status' } } = {}) {
  const addr = leaseName(root, name);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); sock.destroy(); resolve(v); } };
    const sock = net.connect(addr);
    const t = setTimeout(() => finish({ alive: 'unresponsive' }), timeoutMs);
    let connected = false;
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => { connected = true; sock.write(JSON.stringify(msg) + '\n'); });
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i >= 0) { let info = {}; try { info = JSON.parse(buf.slice(0, i)); } catch {} finish({ alive: true, info }); }
    });
    sock.on('end', () => finish(connected ? { alive: true, info: {} } : { alive: false }));
    // Pipe ton tai nhung moi instance dang ban (EBUSY) != khong co ai giu -> khong duoc coi la stale.
    // r3.1 (F1): EPERM/EACCES -> 'foreign' (KHONG phai stale: relaunch se lai bi chan -> hub tra runner_failed/lease_permission)
    sock.on('error', (e) => {
      if (connected) return finish({ alive: true, info: {} });
      const k = classifyPipeError(e.code);
      finish(k === 'busy' ? { alive: 'unresponsive', code: e.code } : k === 'foreign' ? { alive: 'foreign', code: e.code } : { alive: false, code: e.code });
    });
  });
}
