import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task } from './helpers.mjs';
import { beginAttempt, finishAttempt } from '../src/engine.mjs';
import { beginNativeUsage, recordNativeUsage } from '../src/native-state.mjs';
import { readBundleText, bundleCacheStatus } from '../src/bundle-cache.mjs';
import { fileHash } from '../src/util.mjs';
import { nativeToolHandler } from '../src/native-tools.mjs';
import { normalizeCodexQuota, verifyResultTermination } from '../src/native-recovery.mjs';
import { updatePool } from '../src/resources.mjs';

const usage = (i, o, c = 0) => ({ input_tokens: i, output_tokens: o, cached_input_tokens: c, cost_usd: null });
test('session accounting subtracts baseline, deduplicates scoped events and rejects silent resets/overlap', (t) => {
  const { store } = fixture(t); task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'account').attempt;
  beginNativeUsage(store, a.attempt_id, { counter_id: 'history', epoch: 'one', scope: 'group_total',
    coverage: 'root_and_children', baseline: usage(1000, 200, 100) });
  assert.deepEqual(recordNativeUsage(store, a.attempt_id, usage(1100, 220, 110), { sequence: 2 }), usage(100, 20, 10));
  assert.deepEqual(recordNativeUsage(store, a.attempt_id, usage(1100, 220, 110), { sequence: 2 }), usage(100, 20, 10));
  assert.deepEqual(recordNativeUsage(store, a.attempt_id, usage(1050, 210, 105), { sequence: 1 }), usage(100, 20, 10));
  assert.throws(() => recordNativeUsage(store, a.attempt_id, usage(1101, 220, 110), { sequence: 2 }), /duplicate/);
  assert.throws(() => recordNativeUsage(store, a.attempt_id, usage(5, 2), { sequence: 3 }), /decreased/);
  assert.throws(() => recordNativeUsage(store, a.attempt_id, usage(1150, 230, 110), { scope: 'child' }), /Overlapping/);
  assert.throws(() => recordNativeUsage(store, a.attempt_id, usage(1150, 230, 110), { epoch: 'two' }), /epoch/);
  assert.throws(() => beginNativeUsage(store, a.attempt_id, { counter_id: 'history', epoch: 'two', scope: 'group_total',
    coverage: 'root_and_children', baseline: usage(0, 0) }), /already bound/);
  const done = finishAttempt(store, a.attempt_id, { status: 'failed', usage: store.read().attempts[a.attempt_id].native_usage });
  assert.equal(done.accounted_tokens, 120);
});
test('bundle cache rechecks identity, rejects changed reads and stays bounded', (t) => {
  const { directory } = fixture(t), file = path.join(directory, 'bundle.md');
  fs.writeFileSync(file, 'first');
  const first = { file, ref: { sha256: fileHash(file) } };
  assert.equal(readBundleText(first), 'first');
  fs.writeFileSync(file, 'second');
  assert.equal(readBundleText({ file, ref: { sha256: fileHash(file) } }), 'second');
  const status = bundleCacheStatus();
  assert(status.bytes <= status.max_bytes && status.entries <= status.max_entries);
});
test('native ranged reads preserve exact bytes and explicit baselines without loading an oversized file', async (t) => {
  const { store, directory } = fixture(t); task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'read').attempt;
  const text = 'é😀'.repeat(15000); fs.writeFileSync(path.join(directory, 'large.txt'), text);
  const handle = nativeToolHandler(store, a.attempt_id);
  await assert.rejects(handle('harness_read', { path: 'large.txt', root: 'workspace' }, 'whole'), /explicit byte range/);
  const part = await handle('harness_read', { path: 'large.txt', root: 'workspace', offset_bytes: 1, max_bytes: 100 }, 'range');
  assert.equal(part.returned_bytes, 100); assert.equal(part.next_offset_bytes, 101);
  assert.deepEqual(Buffer.from(part.bytes_base64, 'base64'), Buffer.from(text).subarray(1, 101));
  assert.equal(part.sha256, fileHash(path.join(directory, 'large.txt')));
});

test('native exhausted percentages block admission without converting percent to token counts', (t) => {
  const { store } = fixture(t, (c) => {
    c.quota_pools ||= {};
    c.quota_pools.shared = { max_concurrent: 2, max_snapshot_age_ms: 10000, reserve_tokens: 0, unknown_policy: 'allow_bounded' };
    c.backends.mock.quota_pool_ids = ['shared'];
  });
  task(store);
  const snapshot = normalizeCodexQuota({ rateLimitsByLimitId: { shared: {
    primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 500 }
  } } }, 'shared');
  updatePool(store, 'shared', snapshot);
  assert.equal(store.read().pools.shared.snapshot.remaining_tokens, null);
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'quota'), /blocks ordinary/);
});

test('unknown recovered output requires owner and descendant evidence and does not settle during reconciliation', (t) => {
  const { store, directory } = fixture(t); task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'unknown').attempt;
  finishAttempt(store, a.attempt_id, { status: 'unknown' });
  assert.throws(() => verifyResultTermination(store, a.attempt_id, {}, 'local', 1), /termination evidence/);
  fs.writeFileSync(path.join(directory, 'stopped.txt'), 'fixture: worker and descendants stopped');
  const evidence = [{ path: 'stopped.txt', sha256: fileHash(path.join(directory, 'stopped.txt')) }];
  assert.throws(() => verifyResultTermination(store, a.attempt_id, { attempt_id: a.attempt_id, evidence, descendants_verified: true }, 'old', 1), /owner/);
  const verified = verifyResultTermination(store, a.attempt_id, { attempt_id: a.attempt_id, evidence, descendants_verified: true }, 'local', 1);
  assert.equal(verified.settled, false);
  assert.equal(verified.observed_state, 'unknown');
  assert(verified.recovered_result_termination);
});


test('recovered termination preserves extension receipts and refuses unresolved helper jobs', (t) => {
  const {store,directory}=fixture(t); task(store);
  const a=beginAttempt(store,'review_scope','local',1,'helper-recovery').attempt;
  finishAttempt(store,a.attempt_id,{status:'unknown'});
  fs.writeFileSync(path.join(directory,'proof.txt'),'terminal helper receipt');
  const observation={attempt_id:a.attempt_id,evidence:[{path:'proof.txt',sha256:fileHash(path.join(directory,'proof.txt'))}],descendants_verified:true};
  store.transaction(s=>s.attempts[a.attempt_id].job_refs.push({job_id:'helper',kind:'extension',observed_state:'running'}));
  assert.throws(()=>verifyResultTermination(store,a.attempt_id,observation,'local',1),/Resolve registered/);
  store.transaction(s=>s.attempts[a.attempt_id].job_refs[0].observed_state='completed');
  const recovered=verifyResultTermination(store,a.attempt_id,observation,'local',1);
  assert.equal(recovered.job_refs[0].observed_state,'completed');
});
