// Only retry SQLite contention, within a window shorter than the assignment lease.
export function sqliteContention(error) {
  return ['SQLITE_BUSY', 'SQLITE_LOCKED'].some((code) => error?.code === code || error?.code?.startsWith(code + '_')) ||
    Number.isInteger(error?.errcode) && [5, 6].includes(error.errcode & 255);
}
export function monitorRetryWindow(leaseMs) {
  return Math.max(1, Math.min(30000, Math.floor(leaseMs / 2)));
}
