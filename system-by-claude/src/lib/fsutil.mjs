// Tien ich file-system: ghi nguyen tu (tmp + rename), append JSONL, doc JSONL chiu duoc dong cuoi bi cat.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Ghi JSON nguyen tu: ghi file tam roi rename. Tren Windows rename de len file dang mo co the EPERM -> thu lai ngan. */
export function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  let lastErr;
  for (let i = 0; i < 20; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') break;
      sleepSync(10 * (i + 1));
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  throw lastErr;
}

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && (e.code === 'ENOENT' || e instanceof SyntaxError)) return fallback;
    throw e;
  }
}

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

/** Append mot dong JSON + fsync. Mot dong <= vai KB nen append la nguyen tu tren thuc te (1 writer duy nhat/ file). */
export function appendJsonLine(file, obj) {
  // Neu lan ghi truoc bi cat giua dong (crash), them '\n' de dong moi khong dinh vao dong hong.
  let prefix = '';
  try {
    const size = fs.statSync(file).size;
    if (size > 0) {
      const b = Buffer.alloc(1);
      const rfd = fs.openSync(file, 'r');
      try { fs.readSync(rfd, b, 0, 1, size - 1); } finally { fs.closeSync(rfd); }
      if (b[0] !== 0x0a) prefix = '\n';
    }
  } catch {}
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, prefix + JSON.stringify(obj) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Doc JSONL; bo qua dong cuoi hong (crash giua luc ghi) thay vi nem loi. */
export function readJsonLines(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* dong hong (thuong la dong cuoi) -> bo qua */ }
  }
  return out;
}

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}
