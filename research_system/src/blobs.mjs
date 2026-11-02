import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { confined, requireThat, fileHash, id } from './util.mjs';

// Only the core writes these blobs. Workers receive an execution directory, never a second DB.
export async function pinFile(root, source, expected = null, maxBytes = Infinity) {
  const directory = confined(root, '.agentic/output-snapshots', false);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, id('staging'));
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  try {
    await pipeline(fs.createReadStream(source), new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) return callback(new Error('Snapshot exceeds byte budget'));
        digest.update(chunk); callback(null, chunk);
      }
    }), fs.createWriteStream(temp, { flags: 'wx', highWaterMark: 65536 }));
    const sha256 = digest.digest('hex');
    requireThat(!expected || sha256 === expected, 'Snapshot hash mismatch: ' + source);
    const fd = fs.openSync(temp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const relative = path.posix.join('.agentic/output-snapshots', sha256);
    const target = confined(root, relative, false);
    // Atomic create-if-absent without replacing a referenced immutable blob.
    try { fs.linkSync(temp, target); }
    catch (e) { if (e.code !== 'EEXIST') throw e; requireThat(fileHash(target) === sha256, 'Existing snapshot changed'); }
    return { path: relative, sha256, bytes };
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function copyFileDurable(source, target, maxBytes = Infinity) {
  const input = fs.openSync(source, 'r');
  let output;
  try {
    output = fs.openSync(target, 'wx');
    const buffer = Buffer.allocUnsafe(65536);
    let n, bytes = 0;
    while ((n = fs.readSync(input, buffer, 0, buffer.length, null))) {
      bytes += n; requireThat(bytes <= maxBytes, 'Snapshot exceeds byte budget');
      let offset = 0;
      while (offset < n) offset += fs.writeSync(output, buffer, offset, n - offset);
    }
    fs.fsyncSync(output);
  } catch (error) {
    if (output !== undefined && fs.existsSync(target)) fs.unlinkSync(target);
    throw error;
  } finally { fs.closeSync(input); if (output !== undefined) fs.closeSync(output); }
}
