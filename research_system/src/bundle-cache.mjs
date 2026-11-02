import fs from 'node:fs';
import { hash, requireThat } from './util.mjs';

const cache = new Map();
let bytes = 0;
const MAX_BYTES = 4 * 1024 * 1024, MAX_ENTRIES = 64;
// The caller resolves policy/permissions and computes the current content hash before every lookup.
export function readBundleText(resource) {
  const key = resource.file + ':' + resource.ref.sha256;
  if (cache.has(key)) {
    const value = cache.get(key); cache.delete(key); cache.set(key, value); return value.text;
  }
  const text = fs.readFileSync(resource.file, 'utf8');
  requireThat(hash(text) === resource.ref.sha256, 'Bundle changed while reading');
  const size = Buffer.byteLength(text);
  if (size > MAX_BYTES) return text;
  while (cache.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) {
    const first = cache.keys().next().value; bytes -= cache.get(first).bytes; cache.delete(first);
  }
  cache.set(key, { text, bytes: size }); bytes += size;
  return text;
}
export const bundleCacheStatus = () => ({ entries: cache.size, bytes, max_entries: MAX_ENTRIES, max_bytes: MAX_BYTES });
