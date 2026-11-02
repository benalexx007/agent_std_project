// These tests exercise only a permission state machine with synthetic records.
// They do not execute a scientific/model benchmark or estimate model quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task, resultFor } from './helpers.mjs';
import { rawArtifact } from './research-fixtures.mjs';
import { requestBenchmark, confirmBenchmark, benchmarkAdmission, supersedeBenchmark } from '../src/benchmarks.mjs';
import { beginAttempt, finishAttempt, dispatchAllowed } from '../src/engine.mjs';

function pending(store, directory, overrides = {}) {
  const protocol = rawArtifact(directory, 'protocol.md', '# Synthetic permission fixture\nNo model, dataset or benchmark will run.');
  task(store, { purpose: 'benchmark', benchmark_request_id: 'request1' });
  return requestBenchmark(store, { request_id: 'request1', purpose: 'Permission-state-machine test only', protocol,
    task_ids: ['review_scope'], limits: { max_attempts: 2, max_tokens: 1000, max_cost_usd: 0 }, ...overrides }, 'local', 1);
}
const approval = (r) => ({ decision: 'approve', protocol_sha256: r.protocol.sha256, confirmation_text: 'Synthetic human-message fixture for a unit test; no benchmark run.' });

test('benchmark dispatch is blocked until a scoped protocol confirmation exists', (t) => {
  const { store, directory } = fixture(t); const request = pending(store, directory);
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'blocked'), /explicit user confirmation/);
  assert.equal(Object.keys(store.read().attempts).length, 0);
  confirmBenchmark(store, request.request_id, approval(request), 'local', 1);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'permitted').attempt;
  assert.equal(a.benchmark_request_id, request.request_id);
  assert.equal(store.read().benchmarks.requests.request1.status, 'started');
});

test('blanket approval, changed protocol and missing human text do not grant execution', (t) => {
  const { store, directory } = fixture(t); const r = pending(store, directory);
  assert.throws(() => confirmBenchmark(store, r.request_id, { ...approval(r), confirmation_text: '' }, 'local', 1), /human confirmation/);
  assert.throws(() => confirmBenchmark(store, r.request_id, { ...approval(r), protocol_sha256: 'a'.repeat(64) }, 'local', 1), /scope\/protocol/);
  fs.writeFileSync(path.join(directory, r.protocol.path), 'New scope');
  assert.throws(() => confirmBenchmark(store, r.request_id, approval(r), 'local', 1), /hash mismatch/);
});

test('each request is single-use and completed approval cannot be reused', (t) => {
  const { store, directory } = fixture(t); const r = pending(store, directory);
  confirmBenchmark(store, r.request_id, approval(r), 'local', 1);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'fixture-state-transition').attempt;
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  assert.equal(store.read().benchmarks.requests.request1.status, 'completed');
  assert.throws(() => benchmarkAdmission(store.read(), store.read().tasks.review_scope.spec, { tokens: 0, cost_usd: 0 }), /confirmation/);
  assert.throws(() => requestBenchmark(store, r, 'local', 1), /unknown|single-use/);
});

test('approved benchmark limits include retries and reserved tokens before dispatch', (t) => {
  const { store, directory } = fixture(t); const r = pending(store, directory, { limits: { max_attempts: 1, max_tokens: 500, max_cost_usd: 0 } });
  confirmBenchmark(store, r.request_id, approval(r), 'local', 1);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'bounded').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', error: 'synthetic failure' });
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'retry-outside-approval'), /attempt limit/);
});

test('protocol mutation after approval is checked again at the final dispatch barrier', (t) => {
  const { store, directory } = fixture(t); const r = pending(store, directory);
  confirmBenchmark(store, r.request_id, approval(r), 'local', 1);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'intent').attempt;
  assert.equal(dispatchAllowed(store.read(), a.attempt_id, a.runner_token), true);
  fs.writeFileSync(path.join(directory, r.protocol.path), 'Changed after intent');
  assert.equal(dispatchAllowed(store.read(), a.attempt_id, a.runner_token), false);
});

test('ordinary implementation tasks do not need benchmark approval', (t) => {
  const { store } = fixture(t); task(store);
  assert.equal(beginAttempt(store, 'review_scope', 'local', 1, 'ordinary').attempt.benchmark_request_id, undefined);
});

test('execution manifest is pinned through confirmation and final dispatch', (t) => {
  const {store,directory}=fixture(t);
  const manifest=rawArtifact(directory,'manifest.json','{"stages":["synthetic"]}');
  const r=pending(store,directory,{execution_manifest:manifest});
  confirmBenchmark(store,r.request_id,approval(r),'local',1);
  const a=beginAttempt(store,'review_scope','local',1,'manifest-test').attempt;
  fs.writeFileSync(path.join(directory,manifest.path),'{}');
  assert.equal(dispatchAllowed(store.read(),a.attempt_id,a.runner_token),false);
});

test('superseding an unapproved campaign preserves history and grants no execution', (t) => {
  const {store,directory}=fixture(t),r=pending(store,directory);
  const replacement={request_id:'new_request',workspace:directory,reason:'New model policy requires a new protocol'};
  assert.throws(()=>supersedeBenchmark(store,r.request_id,replacement,'local',2),/owner/);
  const updated=supersedeBenchmark(store,r.request_id,replacement,'local',1);
  assert.equal(updated.status,'superseded');
  assert.deepEqual(updated.protocol,r.protocol);
  assert.equal(updated.confirmation,null);
  assert.throws(()=>confirmBenchmark(store,r.request_id,approval(r),'local',1),/pending/);
  assert.throws(()=>beginAttempt(store,'review_scope','local',1,'no-old-run'),/confirmation/);
});
