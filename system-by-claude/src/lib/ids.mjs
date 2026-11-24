import crypto from 'node:crypto';

/** Id sap xep duoc theo thoi gian (kieu ULID rut gon): <prefix>_<ms base36><rand>. */
export function newId(prefix = 't') {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = crypto.randomBytes(5).toString('hex');
  return `${prefix}_${t}${r}`;
}
