// Regression cases from the operational review. Deterministic local fixtures only; no models/benchmarks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task, spec, resultFor } from './helpers.mjs';
import { rawArtifact, record, hypothesis, evidence, review, feedback } from './research-fixtures.mjs';
import { beginAttempt, finishAttempt, reopenTask, reviseTask, currentTaskResult, control, requestDecision, answerDecision, registerTask, validateResult, reservations, observeJob } from '../src/engine.mjs';
import { runTask, runAttempt } from '../src/runner.mjs';
import { saveCheckpoint, saveFinalCheckpoint } from '../src/checkpoints.mjs';
import { recordResearch, recordRef, researchPacket } from '../src/research.mjs';
import { proposeImprovement } from '../src/improvements.mjs';
import { recordTelemetry, updatePool } from '../src/resources.mjs';
import { classifyFailure } from '../src/failures.mjs';
import { parseOutput, validateInvocation, capabilities } from '../adapters/index.mjs';
import { collectResults } from '../src/artifacts.mjs';
import { contract } from '../src/schema.mjs';
import { main } from '../scripts/harness.mjs';
import { ROOT, readJSON } from '../src/util.mjs';

const unit = (id, dependencies = []) => ({ work_unit_id: id, objective: 'Local regression', dependencies, expected_artifacts: [],
  estimate: { work_tokens: 100, validation_tokens: 10, checkpoint_tokens: 20, margin_tokens: 10, cost_usd: 0, context_growth_tokens: 100 } });
const multi = { budget: { ...spec().budget, max_attempts: 8 }, work_units: [unit('one'), unit('two', ['one'])] };
function complete(store, taskId, key, changes = {}) {
  const a = beginAttempt(store, taskId, 'local', 1, key).attempt;
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a, changes) }); return a;
}
let eventSequence = 0;
const action = (store, kind, target = 'project') => control(store, { event_id: kind + '_' + ++eventSequence, action: kind, target, payload: {} });

test('review reopening preserves completed units, revisions, budgets and historical attempts', (t) => {
  const { store } = fixture(t); task(store, multi);
  const first = complete(store, 'review_scope', 'one');
  const second = beginAttempt(store, 'review_scope', 'local', 1, 'two').attempt;
  finishAttempt(store, second.attempt_id, { status: 'failed', result: resultFor(second, { status: 'inconclusive' }) });
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'blocked'), /needs_review/);
  assert.throws(() => reopenTask(store, 'review_scope', { reason: 'Review' }, 'stale', 1), /owner/);
  const result = reopenTask(store, 'review_scope', { reason: 'Reviewed missing verification; continue unfinished unit' }, 'local', 1);
  assert.deepEqual(result.preserved_units, ['one']);
  assert.deepEqual(result.rerun_units, ['two']);
  complete(store, 'review_scope', 'three');
  const state = store.read();
  assert.equal(state.tasks.review_scope.revision, 1);
  assert.equal(state.work_units['review_scope/one'].attempts.length, 1);
  assert.equal(state.work_units['review_scope/one'].result.attempt_id, first.attempt_id);
  assert.equal(state.tasks.review_scope.attempts.length, 3);
  assert.equal(currentTaskResult(state, 'review_scope'), true);
  contract('work-unit', state.work_units['review_scope/two']);
});

test('a revised upstream can be followed by explicit review of an unchanged queued dependent', (t) => {
  const { store } = fixture(t);
  const parent = task(store, { task_id: 'parent' }); task(store, { dependencies: ['parent'] });
  complete(store, 'parent', 'parent1');
  reviseTask(store, { ...parent, task_revision: 2 }, 'local', 1);
  assert.throws(() => reopenTask(store, 'review_scope', { reason: 'Review' }, 'local', 1), /Dependency/);
  complete(store, 'parent', 'parent2');
  reopenTask(store, 'review_scope', { reason: 'Reviewed new upstream result' }, 'local', 1);
  complete(store, 'review_scope', 'child');
  assert.equal(store.read().tasks.review_scope.revision, 1);
  assert.equal(currentTaskResult(store.read(), 'review_scope'), true);
});

test('reopening refuses unresolved external jobs and never resets an exhausted attempt budget', (t) => {
  const { store, directory } = fixture(t); task(store, { budget: { ...spec().budget, max_attempts: 1 } });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', result: resultFor(a, { status: 'inconclusive' }),
    jobs: [{ job_id: 'external1', kind: 'external', observed_state: 'running' }] });
  assert.throws(() => reopenTask(store, 'review_scope', { reason: 'Review' }, 'local', 1), /active\/unknown/);
  assert.equal(store.read().attempts[a.attempt_id].settled, false);
  observeJob(store, a.attempt_id, 'external1', { status: 'completed', evidence: [rawArtifact(directory, 'remote-done.txt', 'Remote scheduler confirms terminal')] });
  assert.equal(store.read().attempts[a.attempt_id].settled, true);
  reopenTask(store, 'review_scope', { reason: 'Remote work verified terminal' }, 'local', 1);
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'two'), /attempt budget/);
});

test('non-resource errors between units propagate instead of becoming capacity errors', async (t) => {
  const { store, directory } = fixture(t), input = rawArtifact(directory, 'input.txt', 'Original');
  task(store, { ...multi, inputs: [input] });
  const transaction = store.transaction.bind(store); let changed = false;
  store.transaction = (fn) => {
    const result = transaction(fn);
    if (!changed && Object.keys(store.read().checkpoints).length) {
      changed = true; fs.writeFileSync(path.join(directory, input.path), 'Changed after first checkpoint');
    }
    return result;
  };
  await assert.rejects(() => runTask(store, 'review_scope', 'local', 1, 'segments'), /Input changed/);
  assert.notEqual(store.read().tasks.review_scope.status, 'waiting_for_capacity');
  assert.equal(Object.keys(store.read().attempts).length, 1);
});

test('later units may update a public output while historical output snapshots remain checked', (t) => {
  const { store, directory } = fixture(t); task(store, multi);
  const firstRef = rawArtifact(directory, 'report.md', 'Version 1');
  const first = complete(store, 'review_scope', 'one', { artifacts: [firstRef], evidence_refs: [firstRef] });
  const second = beginAttempt(store, 'review_scope', 'local', 1, 'two').attempt;
  const secondRef = rawArtifact(directory, 'report.md', 'Version 2');
  finishAttempt(store, second.attempt_id, { status: 'completed', result: resultFor(second, { artifacts: [secondRef] }) });
  assert.equal(currentTaskResult(store.read(), 'review_scope'), true);
  assert.ok(collectResults(store.read()).results.every((r) => r.validity === 'current'));
  const snapshot = store.read().attempts[first.attempt_id].output_snapshots[0];
  assert.equal(fs.readFileSync(path.join(directory, snapshot.path), 'utf8'), 'Version 1');
  fs.writeFileSync(path.join(directory, snapshot.path), 'Tampered historical version');
  assert.equal(currentTaskResult(store.read(), 'review_scope'), false);
});

test('tampering with the latest public output invalidates a task despite intact snapshots', (t) => {
  const { store, directory } = fixture(t); task(store);
  complete(store, 'review_scope', 'one', { artifacts: [rawArtifact(directory, 'report.md', 'Published')] });
  fs.writeFileSync(path.join(directory, 'report.md'), 'Changed after publication');
  assert.equal(currentTaskResult(store.read(), 'review_scope'), false);
});

test('missing task-level output is rejected before final publication and settles the exited mock', async (t) => {
  const { store } = fixture(t); task(store, { expected_artifacts: ['missing.md'], work_units: [unit('one')] });
  const result = await runTask(store, 'review_scope', 'local', 1, 'missing');
  assert.equal(result.observed_state, 'failed');
  assert.match(result.error, /Task is missing expected artifacts/);
  assert.equal(result.settled, true);
  assert.equal(result.job_refs[0].observed_state, 'exited');
  assert.equal(reservations(store.read()).tokens, 0);
});

test('a finish transaction exception is caught after root exit and does not crash or leak mock reservations', async (t) => {
  const { store } = fixture(t); task(store);
  const transaction = store.transaction.bind(store); let injected = false;
  store.transaction = (fn) => transaction((s) => {
    const result = fn(s);
    if (!injected && Object.values(s.attempts).some((a) => a.observed_state === 'completed' && a.settled)) {
      injected = true; throw new Error('Injected finalization failure');
    }
    return result;
  });
  const a = await runTask(store, 'review_scope', 'local', 1, 'rollback');
  assert.equal(a.observed_state, 'failed');
  assert.equal(a.settled, true);
  assert.equal(a.job_refs[0].observed_state, 'exited');
  assert.match(a.error, /Injected finalization failure/);
});

test('finalization errors retain unknown descendant reservations for an unverified command', async (t) => {
  const code = "let v='';process.stdin.on('data',c=>v+=c);process.stdin.on('end',()=>{const x=JSON.parse(v);console.log(JSON.stringify({task_id:x.task.task_id,task_revision:x.dispatch.task_revision,attempt_id:x.dispatch.attempt_id,protocol_version:x.dispatch.protocol_version,status:'completed',summary:'Local command fixture',artifacts:[],evidence_refs:[],checks:[{name:'fixture',passed:true,details:'local only'}],limitations:[],unresolved:[],usage:{input_tokens:null,output_tokens:null,cached_input_tokens:null,cost_usd:null}}));});";
  const { store } = fixture(t, (c) => { c.execution.allow_external = true; c.backends.local_command = { kind: 'command', command: process.execPath, args: ['-e', code], allow_execute: true }; });
  task(store, { backend: 'local_command' });
  const transaction = store.transaction.bind(store); let injected = false;
  store.transaction = (fn) => transaction((s) => {
    const result = fn(s);
    if (!injected && Object.values(s.attempts).some((a) => a.observed_state === 'completed')) { injected = true; throw new Error('Injected publication error'); }
    return result;
  });
  const a = await runTask(store, 'review_scope', 'local', 1, 'unknown');
  assert.equal(a.observed_state, 'unknown'); assert.equal(a.settled, false);
  assert.equal(a.job_refs[0].observed_state, 'exited');
  assert.ok(reservations(store.read()).tokens > 0);
});

test('pause/resume retains a declined decision until explicit replacement approval', (t) => {
  const { store } = fixture(t); task(store);
  const decision = readJSON(path.join(ROOT, 'examples/decision.json')); requestDecision(store, decision);
  action(store, 'pause'); answerDecision(store, decision.decision_id, 'decline'); action(store, 'resume');
  assert.equal(store.read().tasks.review_scope.status, 'needs_review');
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'blocked'), /needs_review|declined/);
  assert.throws(() => reopenTask(store, 'review_scope', { reason: 'Try to override decline' }, 'local', 1), /declined/);
  const replacement = { ...decision, decision_id: 'replacement', supersedes_decision_id: decision.decision_id };
  requestDecision(store, replacement); answerDecision(store, replacement.decision_id, 'approve');
  assert.doesNotThrow(() => beginAttempt(store, 'review_scope', 'local', 1, 'approved'));
});

test('pause/resume preserves pending decisions, yielded work and waiting capacity', (t) => {
  const { store } = fixture(t); task(store);
  const decision = readJSON(path.join(ROOT, 'examples/decision.json')); requestDecision(store, decision);
  action(store, 'pause'); action(store, 'resume');
  assert.equal(store.read().tasks.review_scope.status, 'waiting_for_user');
  answerDecision(store, decision.decision_id, 'approve');
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'yield').attempt; finishAttempt(store, a.attempt_id, { status: 'yielded' });
  action(store, 'pause'); action(store, 'resume');
  assert.equal(store.read().tasks.review_scope.status, 'yielded');
  store.transaction((s) => { s.tasks.review_scope.status = 'waiting_for_capacity'; });
  action(store, 'pause'); action(store, 'resume');
  assert.equal(store.read().tasks.review_scope.status, 'waiting_for_capacity');
});

test('a paused manual handoff resumes without a second attempt or loss of reservation', async (t) => {
  const { store } = fixture(t); task(store, { backend: 'manual' });
  const pending = await runAttempt(store, 'review_scope', 'local', 1, 'manual');
  action(store, 'pause'); action(store, 'resume');
  assert.equal(store.read().attempts[pending.attempt.attempt_id].desired_state, 'running');
  assert.equal(Object.keys(store.read().attempts).length, 1);
  finishAttempt(store, pending.attempt.attempt_id, { status: 'completed', result: resultFor(pending.attempt) });
  assert.equal(currentTaskResult(store.read(), 'review_scope'), true);
});

test('pause at a multi-unit boundary resumes the next unit instead of restoring a dead running state', async (t) => {
  const { store } = fixture(t); task(store, multi);
  const running = runTask(store, 'review_scope', 'local', 1, 'one'); action(store, 'pause');
  await running;
  action(store, 'resume');
  assert.equal(store.read().tasks.review_scope.status, 'queued');
  await runTask(store, 'review_scope', 'local', 1, 'next');
  assert.equal(store.read().tasks.review_scope.status, 'completed');
  assert.equal(store.read().tasks.review_scope.attempts.length, 2);
});

test('branch selection keeps primary counterevidence/reviews without expanding sibling hypotheses', (t) => {
  const { store, directory } = fixture(t); task(store);
  const put = (r) => recordResearch(store, r, 'local', 1);
  const root = put(record('hypothesis', 'H0', hypothesis()));
  const branch = put(record('hypothesis', 'H1', hypothesis('Selected branch'), [recordRef(root)]));
  const sibling = put(record('hypothesis', 'H2', hypothesis('Sibling branch'), [recordRef(root)]));
  const raw = rawArtifact(directory);
  const counter = put(record('evidence', 'E1', evidence(), [{ ...recordRef(branch), relation: 'subject' }], [raw]));
  put(record('evidence', 'E2', evidence(), [{ ...recordRef(sibling), relation: 'subject' }], [raw]));
  put(record('review', 'R1', review(), [recordRef(counter)], [raw]));
  const spec = store.read().tasks.review_scope.spec;
  const packet = researchPacket(store.read(), { ...spec, research_record_ids: ['H1'] });
  assert.deepEqual(packet.records.map((r) => r.record.record_id).sort(), ['E1', 'H0', 'H1', 'R1']);
  assert.equal(packet.excluded_latest_records, 2);
  assert.equal(researchPacket(store.read(), { ...spec, research_record_ids: [] }).records.length, 0);
});

test('failed/cancelled/unknown attempts cannot publish new checkpoints', (t) => {
  for (const status of ['failed', 'cancelled', 'unknown']) {
    const { store } = fixture(t); task(store);
    const a = beginAttempt(store, 'review_scope', 'local', 1, status).attempt;
    finishAttempt(store, a.attempt_id, { status });
    assert.throws(() => saveCheckpoint(store, a.attempt_id, { summary: 'Late checkpoint', remaining_actions: [], artifacts: [], checks: [], uncertainties: [] }), /Inactive or unknown/);
  }
});

test('final boundary checkpoints derive from validated results and cannot be rewritten by workers', (t) => {
  const { store } = fixture(t); task(store); const a = complete(store, 'review_scope', 'one');
  assert.throws(() => saveCheckpoint(store, a.attempt_id, { summary: 'Forged late summary', remaining_actions: [], artifacts: [], checks: [], uncertainties: [] }), /Inactive/);
  assert.ok(saveFinalCheckpoint(store, a.attempt_id));
  assert.throws(() => saveFinalCheckpoint(store, a.attempt_id), /already checkpointed/);
  contract('attempt', store.read().attempts[a.attempt_id]);
});

test('default single-unit estimates retain checkpoint headroom and request yielding on exhaustion', (t) => {
  const { store } = fixture(t); task(store); const a = beginAttempt(store, 'review_scope', 'local', 1, 'usage').attempt;
  recordTelemetry(store, a.attempt_id, { event_id: 'used', sequence: 1, scope: 'attempt', mode: 'cumulative', includes_children: true,
    input_tokens: 500, output_tokens: 0, cost_usd: 0, context_headroom_tokens: 0 });
  assert.equal(store.read().attempts[a.attempt_id].desired_state, 'yielding');
  assert.equal(a.reservation_tokens, 500);
});

test('backoff tracks a consecutive streak separately and resets after valid recovery signals', (t) => {
  const { store } = fixture(t, (c) => { c.backends.mock.quota_pool_ids = ['shared']; c.quota_pools = { shared: { max_concurrent: 2, max_snapshot_age_ms: 60000, reserve_tokens: 0, unknown_policy: 'allow_bounded' } }; });
  task(store, { budget: { ...spec().budget, max_attempts: 8 } });
  let a = beginAttempt(store, 'review_scope', 'local', 1, 'quota').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', failure: classifyFailure({ code: 'quota_exhausted' }) });
  store.transaction((s) => { s.pools.shared.cooldown_until = new Date(Date.now() - 1000).toISOString(); });
  updatePool(store, 'shared', { observed_at: new Date().toISOString(), remaining_tokens: 10000, resets_at: null, source: 'Local fixture', precision: 'reported_tokens' });
  assert.equal(store.read().pools.shared.failures, 0);
  a = beginAttempt(store, 'review_scope', 'local', 1, 'rate').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', failure: classifyFailure({ code: 'rate_limit' }) });
  store.transaction((s) => { s.pools.shared.cooldown_until = new Date(Date.now() - 1000).toISOString(); });
  updatePool(store, 'shared', { observed_at: new Date().toISOString(), remaining_tokens: 10000, resets_at: null, source: 'Local fixture', precision: 'reported_tokens' });
  assert.equal(store.read().pools.shared.failures, 1); // Token availability does not prove a rate limit ended.
  complete(store, 'review_scope', 'success');
  assert.equal(store.read().pools.shared.failures, 0);
  assert.equal(store.read().pools.shared.total_failures, 2);
});

function proposal(store, directory, id = 'change') {
  const f = recordResearch(store, record('feedback', id + '_feedback', { ...feedback(), config_hash: store.read().config_hash }), 'local', 1);
  const raw = rawArtifact(directory, id + '.md', 'Replacement role'), receipt = rawArtifact(directory, id + '.txt', 'Local review');
  return { change_id: id, reason: 'Local regression', feedback_refs: [recordRef(f)], files: [{ target: 'domains/research/roles/researcher.md', ...raw }], checks: [{ name: 'fixture', passed: true, evidence: [receipt] }] };
}
test('invalid multi-file overlay leaves no orphan and its change ID can be used after correction', (t) => {
  const { store, directory } = fixture(t); task(store);
  const p = proposal(store, directory);
  assert.throws(() => proposeImprovement(store, { ...p, files: [...p.files, { ...p.files[0], target: '../invalid.md' }] }, 'local', 1), /overlays/);
  assert.equal(fs.existsSync(path.join(directory, '.agentic/improvements/change')), false);
  assert.ok(proposeImprovement(store, p, 'local', 1));
});

test('overlay IO rollback cleans only a directory created by that invocation', (t) => {
  const { store, directory } = fixture(t); task(store);
  const p = proposal(store, directory), original = fs.openSync;
  fs.openSync = (...args) => { if (String(args[0]).endsWith('researcher.md') && args[1] === 'wx') throw new Error('Injected snapshot IO error'); return original(...args); };
  try { assert.throws(() => proposeImprovement(store, p, 'local', 1), /Injected snapshot/); } finally { fs.openSync = original; }
  assert.equal(fs.existsSync(path.join(directory, '.agentic/improvements/change')), false);
  const existing = path.join(directory, '.agentic/improvements/change');
  fs.mkdirSync(existing); fs.writeFileSync(path.join(existing, 'sentinel.txt'), 'Preserve existing directory');
  assert.throws(() => proposeImprovement(store, p, 'local', 1), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(existing, 'sentinel.txt'), 'utf8'), 'Preserve existing directory');
});

test('dictionary keys do not satisfy absent dependencies, roles, backends or skills by inheritance', (t) => {
  const { store, loaded } = fixture(t);
  assert.throws(() => registerTask(store, spec({ dependencies: ['toString'] })), /Register dependencies first/);
  assert.throws(() => registerTask(store, spec({ backend: 'toString' })), /Unknown model backend/);
  const valid = registerTask(store, spec({ task_id: 'toString' }));
  assert.equal(valid.spec.task_id, 'toString');
  assert.ok(beginAttempt(store, 'toString', 'local', 1, 'valid-own-key'));
  assert.equal(Object.hasOwn(loaded.config.backends, 'toString'), false);
});

test('Windows preflight rejects shims/oversized argv without shell expansion or truncation', () => {
  assert.throws(() => validateInvocation({ command: 'tool.cmd', args: [] }, 'win32'), /shell shim/);
  assert.throws(() => validateInvocation({ command: 'tool.exe', args: ['-p', 'x'.repeat(40000)] }, 'win32'), /32767/);
  const input = { command: process.execPath, args: ['-e', 'process.exit(0)'] };
  assert.deepEqual(validateInvocation(input).args, input.args);
});

test('native final messages accept a single JSON fence while prose, multiple fences and script transport remain strict', () => {
  const fence = String.fromCharCode(96).repeat(3), raw = '{"task_id":"fixture"}', wrapped = fence + 'json\n' + raw + '\n' + fence;
  assert.equal(parseOutput('text', wrapped).result.task_id, 'fixture');
  const codex = (text) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } });
  assert.equal(parseOutput('codex-jsonl', codex(wrapped)).result.task_id, 'fixture');
  assert.equal(parseOutput('claude-json', JSON.stringify({ result: wrapped })).result.task_id, 'fixture');
  assert.throws(() => parseOutput('text', 'Here is JSON:\n' + wrapped), /JSON|Unexpected/);
  assert.throws(() => parseOutput('text', wrapped + '\n' + wrapped), /JSON|Unexpected/);
  assert.throws(() => parseOutput('result-json', wrapped), /JSON|Unexpected/);
});

test('capabilities distinguish boundary checkpoints from mock-only midrun control', () => {
  for (const kind of ['codex-cli', 'claude-cli', 'agy-cli', 'command']) {
    assert.equal(capabilities({ kind }).checkpoint_boundary, true);
    assert.equal(capabilities({ kind }).checkpoint_midrun, false);
    assert.equal(capabilities({ kind }).cooperative_yield, false);
  }
  assert.equal(capabilities({ kind: 'mock' }).checkpoint_midrun, true);
});

test('only declared writable outputs may use harness-pinned hashes; evidence and historical inputs stay strict', (t) => {
  const { store, directory } = fixture(t);
  const input = rawArtifact(directory, 'source.txt', 'Historical source');
  task(store, { writes_workspace: true, inputs: [input], expected_artifacts: ['report.md', './source.txt'] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'pinning').attempt;
  rawArtifact(directory, 'report.md', 'New output');
  assert.throws(() => validateResult(store.read(), a, resultFor(a, { artifacts: [{ path: 'report.md' }, { path: './source.txt' }] })), /Historical input/);
  assert.throws(() => validateResult(store.read(), a, resultFor(a, { artifacts: [{ path: 'source.txt' }] })), /declared writable/);
  assert.throws(() => validateResult(store.read(), a, resultFor(a, { evidence_refs: [{ path: 'source.txt' }] })), /sha256/);
});

test('new declared outputs can be pinned and snapshot by the harness without an LLM copying hashes', (t) => {
  const { store, directory } = fixture(t); task(store, { writes_workspace: true, expected_artifacts: ['report.md'] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'pinning').attempt;
  const raw = rawArtifact(directory, 'report.md', 'New output');
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a, { artifacts: [{ path: 'report.md' }] }) });
  const s = store.read();
  assert.equal(s.attempts[a.attempt_id].result.artifacts[0].sha256, raw.sha256);
  assert.equal(s.attempts[a.attempt_id].output_snapshots.length, 1);
  assert.equal(currentTaskResult(s, 'review_scope'), true);
});

test('CLI exposes review reopening without changing the task revision', async (t) => {
  const { store, configFile, directory } = fixture(t); task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'one').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', result: resultFor(a, { status: 'inconclusive' }) });
  const file = path.join(directory, 'review.json'); fs.writeFileSync(file, JSON.stringify({ reason: 'Operator reviewed missing evidence' }));
  const result = await main(['reopen-task', '--config', configFile, '--task', 'review_scope', '--file', file, '--owner', 'local', '--epoch', '1']);
  assert.equal(result.status, 'queued'); assert.equal(result.revision, 1);
});

test('planning tolerates second precision only within the attempt start second', (t) => {
  const { store, directory } = fixture(t, (c) => { c.backends.mock.model_family = 'codex'; });
  const analysis = rawArtifact(directory, 'analysis.md', 'Prior analysis'), source = rawArtifact(directory, 'primary.md', 'Primary data');
  task(store, { task_class: 'synthesis_planning', inputs: [analysis, source], analysis_input_paths: [analysis.path] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'planning').attempt;
  const start = new Date(Date.now() - 2000); start.setMilliseconds(781); a.timestamps.created_at = start.toISOString();
  const second = new Date(Math.floor(start.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
  const planning_review = { verified_for_attempt_id: a.attempt_id, status: 'ready', analysis_refs: [analysis],
    primary_checks: [{ claim: 'Claim', method: 'primary_source_read', source, checked_at: second, finding: 'Checked', comparison_with_analysis: 'Narrowed' }],
    research_checks: [{ question: 'Question', query_or_inspection: 'Source inspection', sources: [source], checked_at: second, finding: 'Checked' }],
    disagreements: [], assumptions: [], blocking_questions: [], limitations: [] };
  assert.doesNotThrow(() => validateResult(store.read(), a, resultFor(a, { planning_review })));
  planning_review.primary_checks[0].checked_at = new Date(start.getTime() - 1001).toISOString().replace(/\.\d+Z$/, 'Z');
  assert.throws(() => validateResult(store.read(), a, resultFor(a, { planning_review })), /newly recorded/);
  planning_review.primary_checks[0].checked_at = new Date(start.getTime() - 1).toISOString();
  assert.throws(() => validateResult(store.read(), a, resultFor(a, { planning_review })), /newly recorded/);
});

test('replacement approval resolves an explicit chain of declined decisions', (t) => {
  const { store } = fixture(t); task(store);
  const base = readJSON(path.join(ROOT, 'examples/decision.json'));
  requestDecision(store, base); answerDecision(store, base.decision_id, 'decline');
  const next = { ...base, decision_id: 'second', supersedes_decision_id: base.decision_id };
  requestDecision(store, next); answerDecision(store, next.decision_id, 'decline');
  const last = { ...base, decision_id: 'third', supersedes_decision_id: next.decision_id };
  requestDecision(store, last); answerDecision(store, last.decision_id, 'approve');
  assert.doesNotThrow(() => beginAttempt(store, 'review_scope', 'local', 1, 'approved-chain'));
});

test('a final unit cannot silently modify a previous output without declaring its new version', (t) => {
  const { store, directory } = fixture(t); task(store, multi);
  complete(store, 'review_scope', 'one', { artifacts: [rawArtifact(directory, 'report.md', 'First version')] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'two').attempt;
  rawArtifact(directory, 'report.md', 'Unreported modification');
  assert.throws(() => validateResult(store.read(), a, resultFor(a)), /hash mismatch/);
});

test('selective reruns publish the newest output even when earlier independent units run again', (t) => {
  const { store, directory } = fixture(t);
  task(store, { ...multi, work_units: [unit('one'), unit('two'), unit('three')] });
  complete(store, 'review_scope', 'one', { artifacts: [rawArtifact(directory, 'report.md', 'V1')] });
  complete(store, 'review_scope', 'two', { artifacts: [rawArtifact(directory, 'report.md', 'V2')] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'three').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', result: resultFor(a, { status: 'inconclusive' }) });
  reopenTask(store, 'review_scope', { reason: 'Recheck first unit and unfinished third unit', rerun_units: ['one'] }, 'local', 1);
  const latest = rawArtifact(directory, 'report.md', 'V3');
  complete(store, 'review_scope', 'one-again', { artifacts: [latest] });
  complete(store, 'review_scope', 'three-again');
  assert.equal(store.read().tasks.review_scope.result.artifacts[0].sha256, latest.sha256);
  assert.equal(currentTaskResult(store.read(), 'review_scope'), true);
});

test('CLI manual import publishes a derived final checkpoint', async (t) => {
  const { store, configFile, directory } = fixture(t); task(store, { backend: 'manual' });
  const pending = await runAttempt(store, 'review_scope', 'local', 1, 'manual');
  const file = path.join(directory, 'result.json'); fs.writeFileSync(file, JSON.stringify(resultFor(pending.attempt)));
  const result = await main(['import-result', '--config', configFile, '--attempt', pending.attempt.attempt_id, '--file', file]);
  assert.equal(result.observed_state, 'completed');
  assert.ok(result.final_checkpoint_id);
  assert.equal(Object.keys(store.read().checkpoints).length, 1);
});

test('inconclusive work can report missing promised outputs without becoming a transport failure', (t) => {
  const { store } = fixture(t); task(store, { expected_artifacts: ['unfinished.md'] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'inconclusive').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', result: resultFor(a, { status: 'inconclusive', unresolved: ['Need additional evidence before creating the report'] }) });
  assert.equal(store.read().tasks.review_scope.status, 'needs_review');
  assert.equal(store.read().attempts[a.attempt_id].result.status, 'inconclusive');
  assert.equal(store.read().attempts[a.attempt_id].settled, true);
});

test('a close-time exception before job mapping still records root exit and a durable termination receipt', async (t) => {
  const { store, directory } = fixture(t); task(store);
  const read = store.read.bind(store); let closeReads = 0;
  store.read = () => {
    if (new Error().stack.includes('at complete (') && ++closeReads === 2) throw new Error('Injected close-time read failure');
    return read();
  };
  const result = await runTask(store, 'review_scope', 'local', 1, 'close-read');
  assert.equal(result.observed_state, 'failed'); assert.equal(result.settled, true);
  assert.equal(result.job_refs[0].observed_state, 'exited');
  const receipt = readJSON(path.join(directory, '.agentic/attempts', result.attempt_id, 'termination.json'));
  assert.equal(receipt.exit_code, 0); assert.equal(receipt.descendants, 'none');
});
