import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task, spec, resultFor } from './helpers.mjs';
import { beginAttempt, finishAttempt, control, handoff, reconcile, registerJob, observeJob } from '../src/engine.mjs';
import { runTask } from '../src/runner.mjs';
import { planRecovery } from '../src/recovery.mjs';
import { saveCheckpoint, loadCheckpoint } from '../src/checkpoints.mjs';
import { updatePool, recordTelemetry, budgetAdmission } from '../src/resources.mjs';
import { workKey } from '../src/work.mjs';
import { classifyFailure } from '../src/failures.mjs';
import { buildContext } from '../src/context.mjs';
import { contract } from '../src/schema.mjs';
import { hash } from '../src/util.mjs';
import { main } from '../scripts/harness.mjs';

function setup(t, modify = () => {}) {
  return fixture(t, (c) => {
    c.backends.mock.quota_pool_ids = ['shared'];
    c.backends.same_pool = { kind: 'mock', allow_execute: true, quota_pool_ids: ['shared'] };
    c.backends.backup = { kind: 'mock', allow_execute: true, quota_pool_ids: ['independent'] };
    const definition = { max_concurrent: 2, max_snapshot_age_ms: 60000, reserve_tokens: 50, unknown_policy: 'allow_bounded' };
    c.quota_pools = { shared: definition, independent: { ...definition } };
    c.recovery_policy = { automatic: false, candidates: ['same_pool', 'backup'], max_same_backend_retries: 1,
      max_transfers: 2, max_segments_per_unit: 4, cooldown_ms: 1000 };
    modify(c);
  });
}
function unit(uid, overrides = {}) {
  return { work_unit_id: uid, objective: 'Verify synthetic unit ' + uid, dependencies: [], expected_artifacts: [],
    estimate: { work_tokens: 100, validation_tokens: 10, checkpoint_tokens: 20, margin_tokens: 10, cost_usd: 0, context_growth_tokens: 100 }, ...overrides };
}
function checkpoint(store, a, summary = 'Partial fixture progress') {
  return saveCheckpoint(store, a.attempt_id, { summary, remaining_actions: ['Finish fixture'],
    artifacts: [], checks: [], uncertainties: ['Synthetic'] });
}
function stopForQuota(store, a) {
  return finishAttempt(store, a.attempt_id, { status: 'failed', failure: classifyFailure({ code: 'quota_exhausted' }) });
}
function reviewTask(store, overrides = {}) {
  return task(store, { budget: { ...spec().budget, max_attempts: 8 }, ...overrides });
}
test('a multi-unit task checkpoints each unit and only completes after all units pass', async (t) => {
  const { store } = setup(t);
  reviewTask(store, { work_units: [unit('schema'), unit('parser', { dependencies: ['schema'] })] });
  const result = await runTask(store, 'review_scope', 'local', 1, 'multi');
  assert.equal(result.observed_state, 'completed');
  const state = store.read();
  assert.equal(state.tasks.review_scope.status, 'completed');
  assert.equal(state.tasks.review_scope.attempts.length, 2);
  assert.equal(Object.keys(state.checkpoints).length, 2);
  for (const attempt of Object.values(state.attempts)) contract('attempt', attempt);
  for (const assignment of Object.values(state.assignments)) contract('assignment', assignment);
  for (const u of Object.values(state.work_units)) contract('work-unit', u);
  contract('handoff', handoff(state));
});
test('project reserves prevent a new unit before worker launch', async (t) => {
  const { store } = setup(t, (c) => {
    c.execution.max_tokens = 600;
    c.budget_reserves = { orchestration_tokens: 100, verification_tokens: 100, recovery_tokens: 100, cost_usd: 0 };
  });
  reviewTask(store);
  const result = await runTask(store, 'review_scope', 'local', 1, 'blocked');
  assert.equal(result.remaining_work_status, 'waiting_for_capacity');
  assert.equal(Object.keys(store.read().attempts).length, 0);
});
test('shared-pool reservations reject over-allocation across different agent names', (t) => {
  const { store } = setup(t);
  updatePool(store, 'shared', { remaining_tokens: 800, observed_at: new Date().toISOString(),
    source: 'fixture', precision: 'reported_tokens', resets_at: null });
  reviewTask(store);
  reviewTask(store, { task_id: 'second', backend: 'same_pool' });
  beginAttempt(store, 'review_scope', 'local', 1, 'one');
  assert.throws(() => beginAttempt(store, 'second', 'local', 1, 'two'), /quota pool/);
});
test('unknown/stale pool telemetry follows configured admission policy', (t) => {
  const { store } = setup(t, (c) => { c.quota_pools.shared.unknown_policy = 'block'; });
  reviewTask(store);
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'one'), /unknown or stale/);
  assert.throws(() => updatePool(store, 'shared', { remaining_tokens: 1, observed_at: 'bad', source: 'fixture',
    precision: 'reported_tokens', resets_at: null }), /timestamp/);
});
test('context admission accounts for next-step growth and checkpoint reserve', (t) => {
  const { store } = setup(t, (c) => { c.backends.mock.context_window_tokens = 10; });
  reviewTask(store, { work_units: [unit('one')] });
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'one'), /context headroom/);
});
test('A to B fallback keeps completed units and skips B if it shares the exhausted pool', async (t) => {
  const { store } = setup(t, (c) => { c.recovery_policy.automatic = true; });
  reviewTask(store, { work_units: [
    unit('schema', { mock: { duration_ms: 20 } }),
    unit('parser', { dependencies: ['schema'], mock: { duration_ms: 150, checkpoint_after_ms: 10, failure_code: 'quota_exhausted' } })
  ] });
  const result = await runTask(store, 'review_scope', 'local', 1, 'fallback');
  assert.equal(result.backend, 'backup');
  const state = store.read(), attempts = Object.values(state.attempts);
  assert.equal(state.tasks.review_scope.status, 'completed');
  assert.equal(attempts.length, 3);
  assert.equal(attempts.filter((a) => a.work_unit_id === 'schema').length, 1);
  const replacement = attempts.at(-1);
  assert.equal(replacement.supersedes_attempt_id, attempts[1].attempt_id);
  assert.ok(replacement.resumed_from_checkpoint);
  assert.equal(replacement.assignment_generation, 2);
  const recovery = Object.values(state.recoveries)[0];
  assert.equal(recovery.candidates.find((c) => c.backend === 'same_pool').allowed, false);
});
test('handoff remains possible without a final answer from A', async (t) => {
  const { store } = setup(t);
  reviewTask(store, { mock: { duration_ms: 100, checkpoint_after_ms: 10, failure_code: 'quota_exhausted' } });
  const a = await runTask(store, 'review_scope', 'local', 1, 'one');
  assert.equal(a.result, undefined);
  const recovery = planRecovery(store, 'review_scope', 'local', 1);
  assert.equal(recovery.target_backend, 'backup');
  assert.ok(recovery.checkpoint_id);
});
test('checkpoint publication failure does not select an orphan manifest', (t) => {
  const { store } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  const first = checkpoint(store, a);
  assert.throws(() => saveCheckpoint(store, a.attempt_id, { summary: 'Unpublished', remaining_actions: [],
    artifacts: [], checks: [], uncertainties: [] }, () => { throw new Error('injected power loss'); }), /power loss/);
  assert.equal(store.read().work_units[workKey('review_scope', 'main')].checkpoint_id, first.checkpoint_id);
  assert.equal(Object.keys(store.read().checkpoints).length, 1);
});
test('a corrupted latest checkpoint falls back to the prior durable manifest', (t) => {
  const { store, directory } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  const first = checkpoint(store, a), second = checkpoint(store, a, 'Second');
  fs.writeFileSync(path.join(directory, second.manifest_path), '{partial');
  stopForQuota(store, a);
  const recovery = planRecovery(store, 'review_scope', 'local', 1);
  assert.equal(recovery.status, 'ready');
  assert.equal(recovery.checkpoint_id, first.checkpoint_id);
});
test('changed checkpoint artifacts prevent blind reuse', (t) => {
  const { store, directory } = setup(t);
  reviewTask(store, { writes_workspace: true });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  fs.writeFileSync(path.join(directory, 'patch.txt'), 'original');
  saveCheckpoint(store, a.attempt_id, { summary: 'Partial diff', remaining_actions: ['Review'], artifacts: [{ path: 'patch.txt', sha256: hash('original') }], checks: [], uncertainties: [] });
  fs.writeFileSync(path.join(directory, 'patch.txt'), 'changed');
  stopForQuota(store, a);
  assert.equal(planRecovery(store, 'review_scope', 'local', 1).status, 'blocked');
});
test('stale worker generation cannot publish a checkpoint after takeover', (t) => {
  const { store } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  checkpoint(store, a); stopForQuota(store, a);
  const recovery = planRecovery(store, 'review_scope', 'local', 1);
  const b = beginAttempt(store, 'review_scope', 'local', 1, 'two', { recoveryId: recovery.recovery_id }).attempt;
  assert.equal(b.backend, 'backup');
  assert.throws(() => checkpoint(store, a), /Stale assignment/);
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  assert.equal(store.read().tasks.review_scope.status, 'running');
});
test('pause between recovery preparation and dispatch wins over fallback', (t) => {
  const { store } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  checkpoint(store, a); stopForQuota(store, a);
  const recovery = planRecovery(store, 'review_scope', 'local', 1);
  control(store, { event_id: 'pause-transfer', action: 'pause', target: 'review_scope', payload: {} });
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'two', { recoveryId: recovery.recovery_id }), /blocked/);
});
test('lease expiry marks unknown but does not authorize a second writer', (t) => {
  const { store } = setup(t);
  reviewTask(store, { writes_workspace: true });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  store.transaction((s) => { s.assignments[a.assignment_id].lease_expires_at = '2000-01-01T00:00:00.000Z'; });
  reconcile(store);
  assert.equal(store.read().attempts[a.attempt_id].observed_state, 'unknown');
  assert.match(planRecovery(store, 'review_scope', 'local', 1).reason, /Reconcile/);
});
test('running external jobs survive worker exit and are never relaunched by recovery', (t) => {
  const { store, directory } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  registerJob(store, a.attempt_id, { job_id: 'gpu-job', kind: 'external', handle: { scheduler_id: 'fixture-job' } });
  stopForQuota(store, a);
  const blocked = planRecovery(store, 'review_scope', 'local', 1);
  assert.match(blocked.reason, /external jobs still running/);
  fs.writeFileSync(path.join(directory, 'job.txt'), 'scheduler confirms done');
  observeJob(store, a.attempt_id, 'gpu-job', { status: 'completed',
    evidence: [{ path: 'job.txt', sha256: hash('scheduler confirms done') }] });
  assert.equal(planRecovery(store, 'review_scope', 'local', 1).status, 'ready');
});
test('telemetry cumulative snapshots replace totals and never double-count on final settlement', (t) => {
  const { store } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  const update = { event_id: 'u1', sequence: 1, scope: 'attempt', mode: 'cumulative', includes_children: true,
    input_tokens: 10, output_tokens: 5, cost_usd: 0, context_headroom_tokens: null };
  recordTelemetry(store, a.attempt_id, update);
  recordTelemetry(store, a.attempt_id, { ...update, event_id: 'u2', sequence: 2, input_tokens: 20 });
  assert.throws(() => recordTelemetry(store, a.attempt_id, update), /Duplicate/);
  finishAttempt(store, a.attempt_id, { status: 'failed', failure: classifyFailure({ code: 'max_tokens' }) });
  assert.equal(store.read().usage.known_tokens, 25);
});
test('low predicted headroom requests yielding before a hard cutoff', (t) => {
  const { store } = setup(t);
  reviewTask(store, { work_units: [unit('one')] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  recordTelemetry(store, a.attempt_id, { event_id: 'u1', sequence: 1, scope: 'attempt', mode: 'cumulative',
    includes_children: true, input_tokens: 90, output_tokens: 0, cost_usd: 0,
    context_headroom_tokens: 40, next_step_tokens: 30 });
  assert.equal(store.read().attempts[a.attempt_id].desired_state, 'yielding');
});
test('cooperative yielding produces a durable checkpoint without marking the unit done', async (t) => {
  const { store } = setup(t);
  reviewTask(store, { mock: { duration_ms: 2000, yield_after_ms: 10 } });
  const a = await runTask(store, 'review_scope', 'local', 1, 'one');
  assert.equal(a.observed_state, 'yielded');
  assert.ok(store.read().attempts[a.attempt_id].checkpoint_id);
  assert.equal(store.read().tasks.review_scope.status, 'yielded');
});
test('explicit migration preserves v1 history after unfinished attempts are resolved', async (t) => {
  const { store, directory } = setup(t);
  reviewTask(store);
  beginAttempt(store, 'review_scope', 'local', 1, 'one');
  store.db.exec('DROP TRIGGER writer_generation_guard');
  store.transaction((state) => {
    state.schema_version = 1;
    for (const key of ['work_units', 'assignments', 'checkpoints', 'recoveries', 'pools']) delete state[key];
  });
  assert.throws(() => store.migrate(), /active\/unknown/);
  const legacy = store.read();
  for (const a of Object.values(legacy.attempts)) { a.observed_state = 'failed'; a.settled = true; }
  store.db.prepare('UPDATE state SET payload=? WHERE id=1').run(JSON.stringify(legacy));
  const migrated = await main(['migrate-state', '--workspace', directory]);
  assert.equal(migrated.schema_version, 4);
  assert.ok(fs.existsSync(migrated.backup));
  assert.equal(Object.values(store.read().attempts)[0].observed_state, 'failed');
  assert.equal(store.migrate().migrated, false);
});
test('retry and transfer counters prevent an unbounded fallback loop', (t) => {
  const { store } = setup(t, (c) => { c.recovery_policy.max_transfers = 0; c.recovery_policy.max_same_backend_retries = 0; });
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  stopForQuota(store, a);
  const recovery = planRecovery(store, 'review_scope', 'local', 1);
  assert.equal(recovery.status, 'waiting_for_capacity');
  assert.equal(recovery.candidates.filter((c) => c.allowed).length, 0);
});
test('capability/auth failures are not retried by treating stderr as quota evidence', () => {
  assert.equal(classifyFailure({ code: 'Unauthorized' }).recoverable, false);
  assert.equal(classifyFailure({ message: 'quota exhausted' }).reason, 'worker_failure');
  assert.equal(classifyFailure({ code: 'rate_limit' }).retryable, true);
});
test('historical quantiles are used only after enough matching labeled samples', (t) => {
  const { store } = setup(t);
  for (let index = 1; index <= 5; index++) {
    const tid = 'sample' + index;
    reviewTask(store, { task_id: tid, work_units: [unit('one', { estimate_key: 'comparable-fixture' })] });
    const a = beginAttempt(store, tid, 'local', 1, tid).attempt;
    assert.equal(a.admission.estimate.basis, 'configured_estimate');
    finishAttempt(store, a.attempt_id, { status: 'completed',
      result: resultFor(a, { usage: { input_tokens: index * 100, output_tokens: 0, cached_input_tokens: 0, cost_usd: 0 } }) });
  }
  reviewTask(store, { work_units: [unit('one', { estimate_key: 'comparable-fixture' })] });
  const next = beginAttempt(store, 'review_scope', 'local', 1, 'next').attempt;
  assert.equal(next.admission.estimate.basis, 'historical_quantile_plus_reserve');
  assert.equal(next.reservation_tokens, 530);
});
test('no-progress recovery stops even when worker names and checkpoint IDs change', (t) => {
  const { store } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  checkpoint(store, a); stopForQuota(store, a);
  const recovery = planRecovery(store, 'review_scope', 'local', 1);
  const b = beginAttempt(store, 'review_scope', 'local', 1, 'two', { recoveryId: recovery.recovery_id }).attempt;
  checkpoint(store, b);
  finishAttempt(store, b.attempt_id, { status: 'failed', failure: classifyFailure({ code: 'context_limit' }) });
  const next = planRecovery(store, 'review_scope', 'local', 1);
  assert.equal(next.status, 'waiting_for_capacity');
  assert.match(next.reason, /No new checkpoint evidence/);
});
test('a low-resource update cannot override the user cancellation barrier', (t) => {
  const { store } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  control(store, { event_id: 'stop-first', action: 'cancel', target: 'review_scope', payload: {} });
  recordTelemetry(store, a.attempt_id, { event_id: 'usage-after-stop', sequence: 1, scope: 'attempt', mode: 'cumulative',
    includes_children: true, input_tokens: 490, output_tokens: 0, cost_usd: 0, context_headroom_tokens: 0, next_step_tokens: 100 });
  assert.equal(store.read().attempts[a.attempt_id].desired_state, 'cancelled');
});
test('project stop includes remote jobs whose agent already completed', (t) => {
  const { store, directory } = setup(t);
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  registerJob(store, a.attempt_id, { job_id: 'ongoing-gpu', kind: 'external', handle: { scheduler_id: 'fixture' } });
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  const ack = control(store, { event_id: 'stop-project', action: 'cancel', target: 'project', payload: {} });
  assert.equal(ack.status, 'applied');
  fs.writeFileSync(path.join(directory, 'job.txt'), 'job stopped');
  observeJob(store, a.attempt_id, 'ongoing-gpu', { status: 'cancelled', evidence: [{ path: 'job.txt', sha256: hash('job stopped') }] });
  assert.equal(store.read().events['stop-project'].status, 'verified');
});
test('same-pool recovery becomes eligible after cooldown and a fresh capacity observation', (t) => {
  const { store } = setup(t, (c) => { c.recovery_policy.candidates = []; });
  reviewTask(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  stopForQuota(store, a);
  assert.equal(planRecovery(store, 'review_scope', 'local', 1).status, 'waiting_for_capacity');
  store.transaction((s) => { s.pools.shared.cooldown_until = '2000-01-01T00:00:00.000Z'; });
  updatePool(store, 'shared', { remaining_tokens: 10000, observed_at: new Date().toISOString(),
    source: 'refreshed fixture observation', precision: 'reported_tokens', resets_at: null });
  assert.equal(planRecovery(store, 'review_scope', 'local', 1).status, 'ready');
});
