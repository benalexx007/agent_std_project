import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task, spec, resultFor } from './helpers.mjs';
import { beginAttempt, finishAttempt, control, takeOwnership, adoptResult, reviseTask, reconcile, reservations,
  recordClaim, recordRun, handoff } from '../src/engine.mjs';
import { collectResults, checkEvidence } from '../src/artifacts.mjs';
import { hash } from '../src/util.mjs';

test('dispatch keys are idempotent and ownership epochs fence stale dispatch', (t) => {
  const { store } = fixture(t);
  task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'same-key');
  const b = beginAttempt(store, 'review_scope', 'local', 1, 'same-key');
  assert.equal(b.duplicate, true);
  assert.equal(a.attempt.attempt_id, b.attempt.attempt_id);
  takeOwnership(store, 'next', 1);
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'another-key'), /owner/);
});
test('budget reservations serialize concurrent allocation', (t) => {
  const { store } = fixture(t, (c) => { c.execution.max_tokens = 600; });
  task(store);
  task(store, { task_id: 'second' });
  beginAttempt(store, 'review_scope', 'local', 1, 'first');
  assert.equal(reservations(store.read()).tokens, 500);
  assert.throws(() => beginAttempt(store, 'second', 'local', 1, 'second'), /budget/);
  assert.equal(Object.keys(store.read().attempts).length, 1);
});
test('external agents remain disabled by default even with explicit execute', (t) => {
  const { store } = fixture(t);
  task(store, { backend: 'codex' });
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'live'), /External execution disabled/);
  assert.equal(Object.keys(store.read().attempts).length, 0);
});
test('writer overlap and unresolved jobs block new dispatch', (t) => {
  const { store } = fixture(t);
  task(store, { writes_workspace: true });
  task(store, { task_id: 'second', writes_workspace: true });
  beginAttempt(store, 'review_scope', 'local', 1, 'one');
  assert.throws(() => beginAttempt(store, 'second', 'local', 1, 'two'), /writers/);
});
test('late results from previous owner require explicit adoption', (t) => {
  const { store } = fixture(t);
  task(store);
  const { attempt } = beginAttempt(store, 'review_scope', 'local', 1, 'one');
  takeOwnership(store, 'next', 1);
  finishAttempt(store, attempt.attempt_id, { status: 'completed', result: resultFor(attempt) });
  assert.equal(store.read().tasks.review_scope.status, 'needs_review');
  adoptResult(store, attempt.attempt_id, 'next', 2);
  assert.equal(store.read().tasks.review_scope.status, 'completed');
  assert.equal(store.read().usage.known_tokens, 15);
});
test('duplicate terminal delivery does not double-count usage', (t) => {
  const { store } = fixture(t);
  task(store);
  const { attempt } = beginAttempt(store, 'review_scope', 'local', 1, 'one');
  const outcome = { status: 'completed', result: resultFor(attempt) };
  finishAttempt(store, attempt.attempt_id, outcome);
  finishAttempt(store, attempt.attempt_id, outcome);
  assert.equal(store.read().usage.known_tokens, 15);
});
test('revision invalidates dependent evidence and retains raw results', (t) => {
  const { store } = fixture(t);
  task(store);
  task(store, { task_id: 'dependent', dependencies: ['review_scope'] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  const b = beginAttempt(store, 'dependent', 'local', 1, 'two').attempt;
  finishAttempt(store, b.attempt_id, { status: 'completed', result: resultFor(b) });
  const revised = reviseTask(store, spec({ task_revision: 2, protocol_version: 'fixture-v2' }), 'local', 1);
  assert.ok(revised.invalidated_tasks.includes('dependent'));
  assert.equal(store.read().tasks.dependent.status, 'needs_review');
  assert.equal(store.read().attempts[a.attempt_id].result.summary, 'Fixture result');
  assert.equal(store.read().attempts[b.attempt_id].result.validity, 'stale_dependency');
});
test('changed input blocks reuse by dependent tasks', (t) => {
  const { store, directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'input.txt'), 'original');
  task(store, { inputs: [{ path: 'input.txt' }] });
  task(store, { task_id: 'dependent', dependencies: ['review_scope'] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  fs.writeFileSync(path.join(directory, 'input.txt'), 'changed');
  assert.equal(collectResults(store.read()).results[0].validity, 'stale_or_changed');
  assert.throws(() => beginAttempt(store, 'dependent', 'local', 1, 'two'), /Dependency/);
});
test('event IDs reject conflicting replay and status does not undo pause', (t) => {
  const { store } = fixture(t);
  task(store);
  const req = { event_id: 'pause1', action: 'pause', target: 'project', payload: {} };
  control(store, req);
  assert.equal(control(store, req).status, 'verified');
  assert.throws(() => control(store, { ...req, action: 'resume' }), /different request/);
  control(store, { event_id: 'status1', action: 'status', target: 'project', payload: {} });
  assert.equal(store.read().desired_state, 'paused');
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'one'), /blocked/);
});
test('unknown cancellation retains budget and requires evidence to reconcile', (t) => {
  const { store, directory } = fixture(t);
  task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  finishAttempt(store, a.attempt_id, { status: 'unknown', error: 'Untracked descendants' });
  assert.equal(reservations(store.read()).tokens, 500);
  assert.throws(() => control(store, { event_id: 'resume1', action: 'resume', target: 'project', payload: {} }), /unknown/);
  assert.throws(() => reconcile(store, [{ attempt_id: a.attempt_id, status: 'cancelled', evidence: [] }]), /evidence/);
  fs.writeFileSync(path.join(directory, 'confirmation.txt'), 'Local fixture operator checked the owned job.');
  reconcile(store, [{ attempt_id: a.attempt_id, status: 'cancelled',
    evidence: [{ path: 'confirmation.txt', sha256: hash(fs.readFileSync(path.join(directory, 'confirmation.txt'))) }] }]);
  assert.equal(reservations(store.read()).tokens, 0);
  assert.equal(store.read().usage.estimated_tokens, 500);
});
test('artifact hashes and claim links detect changed files without claiming scientific validity', (t) => {
  const { store, directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'evidence.txt'), 'counterexample');
  const ref = { path: 'evidence.txt', sha256: hash('counterexample') };
  recordClaim(store, { claim_id: 'negative', statement: 'Fixture claim is contradicted', scope: 'Synthetic fixture',
    protocol_version: 'v1', supporting: [], contradicting: [ref], evaluation_status: 'contradicted', limitations: [] });
  assert.equal(checkEvidence(store.read()).passed, true);
  fs.writeFileSync(path.join(directory, 'evidence.txt'), 'edited');
  assert.equal(checkEvidence(store.read()).passed, false);
});
test('run records are immutable and handoff includes pending events and authority', (t) => {
  const { store } = fixture(t);
  task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  const record = { run_id: 'run1', attempt_id: a.attempt_id, protocol_version: a.protocol_version,
    code_revision: 'fixture', patch_sha256: null, data_version: 'fixture', config: {}, model_version: null,
    environment: { mode: 'test' }, started_at: new Date().toISOString(), ended_at: null, status: 'unknown', outputs: [] };
  recordRun(store, record);
  assert.throws(() => recordRun(store, record), /immutable/);
  control(store, { event_id: 'stop1', action: 'cancel', target: 'review_scope', payload: {} });
  const snapshot = handoff(store.read());
  assert.equal(snapshot.pending_events.length, 1);
  assert.equal(snapshot.authorizations[0].id, 'local-work');
  assert.equal(snapshot.reservations.tokens, 500);
});
test('upstream drift invalidates the entire dependency lineage', (t) => {
  const { store, directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'input.txt'), 'original');
  task(store, { inputs: [{ path: 'input.txt' }] });
  task(store, { task_id: 'child', dependencies: ['review_scope'] });
  task(store, { task_id: 'grandchild', dependencies: ['child'] });
  for (const tid of ['review_scope', 'child']) {
    const a = beginAttempt(store, tid, 'local', 1, tid).attempt;
    finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  }
  fs.writeFileSync(path.join(directory, 'input.txt'), 'changed');
  assert.equal(collectResults(store.read()).results.find((r) => r.task_id === 'child').validity, 'stale_or_changed');
  assert.throws(() => beginAttempt(store, 'grandchild', 'local', 1, 'grandchild'), /Dependency/);
});
test('reconciliation updates an unresolved cancel event after evidence is supplied', (t) => {
  const { store, directory } = fixture(t);
  task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  control(store, { event_id: 'stop1', action: 'cancel', target: 'review_scope', payload: {} });
  finishAttempt(store, a.attempt_id, { status: 'unknown' });
  assert.equal(store.read().events.stop1.status, 'unverified');
  fs.writeFileSync(path.join(directory, 'confirmation.txt'), 'fixture confirmation');
  reconcile(store, [{ attempt_id: a.attempt_id, status: 'cancelled',
    evidence: [{ path: 'confirmation.txt', sha256: hash('fixture confirmation') }] }]);
  assert.equal(store.read().events.stop1.status, 'verified');
});
