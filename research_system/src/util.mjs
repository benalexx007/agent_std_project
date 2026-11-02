import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const now = () => new Date().toISOString();
export const id = (prefix) => prefix + '_' + crypto.randomUUID();
export const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
// Bounded-memory hashing for datasets and artifacts, including synchronous validators.
export function fileHash(file) {
  const digest = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(65536);
  const fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
export const clone = (value) => structuredClone(value);
export const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
export function inside(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export function confined(root, ref, mustExist = true) {
  requireThat(typeof ref === 'string' && ref.length > 0, 'Expected a file path');
  const absolute = path.resolve(root, ref);
  requireThat(inside(path.resolve(root), absolute), 'Path escapes allowed root: ' + ref);
  if (mustExist) {
    requireThat(inside(fs.realpathSync(root), fs.realpathSync(absolute)), 'Symlink escapes allowed root: ' + ref);
  } else {
    let ancestor = absolute;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    requireThat(inside(fs.realpathSync(root), fs.realpathSync(ancestor)), 'Parent symlink escapes allowed root');
  }
  return absolute;
}
export function writeJSON(file, value) {
  return writeText(file, JSON.stringify(value, null, 2) + '\n');
}
export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
export function artifactCheck(workspace, artifact) {
  const file = confined(workspace, artifact.path);
  requireThat(fs.statSync(file).isFile(), 'Artifact is not a file: ' + artifact.path);
  const actual = fileHash(file);
  requireThat(artifact.sha256 === actual, 'Artifact hash mismatch: ' + artifact.path);
  return { path: artifact.path, sha256: actual, bytes: fs.statSync(file).size };
}
