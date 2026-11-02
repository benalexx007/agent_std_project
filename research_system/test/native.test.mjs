import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs';
import { fixture, task, spec } from './helpers.mjs';
import { ROOT, hash } from '../src/util.mjs';
import { NativeRPC } from '../src/native-rpc.mjs';
import { probeCodex, nativeThreadParams, inspectCodex, collectCodex, readCodexQuota } from '../src/codex-native.mjs';
import { runTask } from '../src/runner.mjs';
import { beginAttempt, control, takeOwnership, finishAttempt } from '../src/engine.mjs';
import { nativeToolHandler } from '../src/native-tools.mjs';
import { answerNativeInput } from '../src/native-state.mjs';
import { buildOrchestratorContext } from '../src/context.mjs';
import { main } from '../scripts/harness.mjs';
import { resolveTask } from '../src/config.mjs';
import { prepareNativeAcceptance } from '../benchmarks/native/prepare.mjs';
import { gradeNativeAcceptance } from '../benchmarks/native/grade.mjs';
import { normalizeCodexQuota } from '../src/native-recovery.mjs';

function nativeFixture(t, modify = () => {}) {
  return fixture(t, (c) => {
    c.execution.allow_external = true; c.execution.max_tokens = 1000000; c.execution.max_concurrent = 3;
    c.context.max_chars = 150000;
    c.backends.mock.model_family = 'codex';
    c.roles.orchestrator = { profile: 'domains/research/roles/orchestrator.md', skills: ['research-scope'], backend: 'native' };
    c.orchestrator = { backend: 'native', model: null };
    c.backends.native = { kind: 'codex-app-server', command: process.execPath, args: [path.join(ROOT, 'test/fixtures/codex-server.mjs')],
      sandbox: 'read-only', allow_execute: true, native: { version: process.version, delegation_mode: 'harness_workers',
        request_timeout_ms: 1000, input_timeout_ms: 1000, max_frame_bytes: 1048576, max_tool_calls: 8, input_overhead_tokens: 100 } };
    modify(c);
  });
}

test('native bridge keeps the control store outside an isolated execution root', async (t) => {
  const { store } = nativeFixture(t, (c) => {
    c.workspace_policy = { mode: 'snapshot_directory', include: [], max_files: 100, max_bytes: 1048576, max_writers: 1 };
  });
  task(store, { backend: 'native', task_class: 'analysis' });
  const done = await runTask(store, 'review_scope', 'local', 1, 'isolated-native');
  assert.equal(done.observed_state, 'completed', done.error);
  assert(done.workspace.root !== store.read().project.workspace);
  assert.equal(store.read().publications[done.publication_id].status, 'accepted');
});

test('native history collection requires the exact terminal turn and never starts inference or trusts model counters', async (t) => {
  const { loaded, directory } = nativeFixture(t), b = loaded.config.backends.native;
  await assert.rejects(collectCodex(b, { thread_id: 'fixture-thread' }, directory), /Exact turn/);
  await assert.rejects(collectCodex(b, { thread_id: 'fixture-thread', turn_id: 'other-turn' }, directory), /not durably/);
  const read = await collectCodex(b, { thread_id: 'fixture-thread', turn_id: 'saved-turn' }, directory);
  assert.equal(read.inference_started, false); assert.equal(read.accepted, false); assert.equal(read.can_release_reservation, false);
  assert.equal(read.candidate.task_id, 'saved');
  assert.equal(read.candidate.usage.input_tokens, null);
});

test('native quota reads select the explicit limit and preserve percentages separately from tokens', async (t) => {
  const { loaded, directory } = nativeFixture(t);
  const read = await readCodexQuota(loaded.config.backends.native, directory);
  const snapshot = normalizeCodexQuota(read.response, 'codex');
  assert.equal(read.inference_started, false);
  assert.equal(snapshot.remaining_tokens, null); assert.equal(snapshot.precision, 'unknown');
  assert.equal(snapshot.native_windows[0].used_percent, 40);
  assert.throws(() => normalizeCodexQuota(read.response, 'different-account-limit'), /identity/);
});
async function until(fn) { for (let i = 0; i < 250; i++) { if (fn()) return; await delay(20); } throw new Error('Fixture wait timed out'); }

test('native RPC correlates replies, bounds frames and rejects pending calls on transport loss', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const peer = new NativeRPC(input, output, { maxFrameBytes: 128, timeoutMs: 500 });
  peer.on('fault', () => {});
  const answer = peer.request('read');
  input.write('{"id":1,"result":{"ok":true}}\n');
  assert.deepEqual(await answer, { ok: true });
  const lost = peer.request('submit');
  input.write('x'.repeat(129));
  await assert.rejects(lost, /frame exceeds/);
});

test('native launch pin and per-thread config preserve model, effort, permissions and delegation boundary', (t) => {
  const { loaded } = nativeFixture(t), b = loaded.config.backends.native;
  assert.equal(probeCodex(b).inference_started, false);
  assert.throws(() => probeCodex({ ...b, native: { ...b.native, version: 'wrong' } }), /binary changed/);
  const params = nativeThreadParams(b, { role: 'orchestrator', model: 'gpt-6-astra', reasoning_effort: 'high' }, { packet: { workspace: ROOT } });
  assert.equal(params.config['agents.enabled'], false);
  assert.equal(params.config['features.shell_tool'], false);
  assert.equal(params.approvalPolicy, 'never');
  assert.equal(params.allowProviderModelFallback, false);
  assert(!params.dynamicTools.some((t) => /approve|confirm|budget|config/.test(t.name)));
});

test('native process fixture finishes with pinned receipt and authoritative usage instead of model self-report', async (t) => {
  const { store } = nativeFixture(t);
  task(store, { backend: 'native', task_class: 'analysis' });
  const result = await runTask(store, 'review_scope', 'local', 1, 'native-one');
  assert.equal(result.observed_state, 'completed', result.error + '\n' + fs.readFileSync(path.join(store.directory, 'attempts', result.attempt_id, 'stderr.log'), 'utf8'));
  assert.equal(result.native.phase, 'closed');
  assert.equal(result.native.effective.effort, 'high');
  assert.equal(result.accounted_tokens, 120);
  assert.equal(result.reported_usage.cost_usd, null);
  assert.equal(result.session_id, 'fixture-thread');
  assert(result.admission.estimate.tokens > 5000);
  assert.equal((await runTask(store, 'review_scope', 'local', 1, 'native-one')).duplicate, true);
});

test('Codex orchestrator dispatches a separately budgeted worker through core tools', async (t) => {
  const { store } = nativeFixture(t);
  task(store, { role: 'orchestrator', backend: 'native', task_class: 'analysis', skills: ['research-scope'], objective: 'delegate fixture' });
  const result = await runTask(store, 'review_scope', 'local', 1, 'orchestration');
  assert.equal(result.observed_state, 'completed', result.error + '\n' + fs.readFileSync(path.join(store.directory, 'attempts', result.attempt_id, 'stderr.log'), 'utf8'));
  const state = store.read();
  assert.equal(state.tasks.delegated.status, 'completed');
  assert.equal(state.tasks.delegated.orchestration_attempt_id, result.attempt_id);
  assert.equal(result.job_refs.find((j) => j.kind === 'external').observed_state, 'completed');
  assert.equal(Object.keys(state.attempts).length, 2);
});

test('native input persists across CLI reads, validates answers and never becomes project approval', async (t) => {
  const { store, configFile } = nativeFixture(t);
  task(store, { backend: 'native', objective: 'input fixture' });
  const running = runTask(store, 'review_scope', 'local', 1, 'native-input');
  await until(() => Object.values(store.read().attempts)[0]?.native_requests?.['77']);
  const a = Object.values(store.read().attempts)[0];
  const request = await main(['native-requests', '--config', configFile, '--attempt', a.attempt_id]);
  assert.equal(request.requests['77'].status, 'pending');
  assert.throws(() => answerNativeInput(store, a.attempt_id, '77', { answers: { wrong: { answers: ['A'] } } }), /question IDs/);
  answerNativeInput(store, a.attempt_id, '77', { answers: { choice: { answers: ['A'] } } });
  const result = await running;
  assert.equal(result.observed_state, 'completed', result.error + '\n' + fs.readFileSync(path.join(store.directory, 'attempts', result.attempt_id, 'stderr.log'), 'utf8'));
  assert.equal(Object.keys(store.read().decisions).length, 0);
  assert.throws(() => answerNativeInput(store, a.attempt_id, '77', { answers: {} }), /closed/);
});

test('native steer ACK is distinct from application; cancel conservatively retains unknown descendants', async (t) => {
  const { store } = nativeFixture(t);
  task(store, { backend: 'native', objective: 'wait fixture' });
  const running = runTask(store, 'review_scope', 'local', 1, 'native-wait');
  await until(() => Object.values(store.read().attempts)[0]?.native?.phase === 'turn_running');
  control(store, { event_id: 'native-steer', action: 'steer', target: 'review_scope', payload: { message: 'nonce' } });
  await until(() => store.read().events['native-steer'].status === 'acknowledged');
  control(store, { event_id: 'native-cancel', action: 'cancel', target: 'review_scope', payload: {} });
  const result = await running;
  assert.equal(result.observed_state, 'unknown');
  assert.equal(result.settled, false);
  assert.equal(result.native.terminal_status, 'interrupted');
});

test('old orchestration owner cannot register or launch work after takeover', async (t) => {
  const { store } = nativeFixture(t);
  task(store, { role: 'orchestrator', backend: 'native', skills: ['research-scope'] });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'old-owner').attempt;
  const tool = nativeToolHandler(store, a.attempt_id);
  takeOwnership(store, 'new', 1);
  await assert.rejects(tool('harness_register_task', { task: spec({ task_id: 'blocked' }) }, 'stale'), /Stale/);
  assert.equal(store.read().tasks.blocked, undefined);
});

test('native workers can checkpoint but cannot dispatch another worker', async (t) => {
  const { store } = nativeFixture(t);
  task(store, { backend: 'native' });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'checkpoint-tool').attempt;
  const tool = nativeToolHandler(store, a.attempt_id);
  await assert.rejects(tool('harness_register_task', { task: spec({ task_id: 'blocked' }) }, 'nested'), /cannot use/);
  const saved = await tool('harness_checkpoint', { progress: { summary: 'Lemma assumes x != 0; obligation x=0 remains open.', remaining_actions: ['Check x=0'], artifacts: [], checks: [], uncertainties: ['Unproved at x=0'] } }, 'checkpoint');
  assert.equal(store.read().attempts[a.attempt_id].checkpoint_id, saved.checkpoint_id);
  assert.match(JSON.parse(fs.readFileSync(path.join(store.read().project.workspace, saved.manifest_path), 'utf8')).summary, /x=0/);
  assert(saved.durable_at);
});

test('native acceptance grader checks the oracle and current primary evidence without a model', (t) => {
  const { store, directory } = nativeFixture(t);
  const refs = ['primary-spec.md', 'values.csv'].map((file) => {
    fs.writeFileSync(path.join(directory, file), file);
    return { path: file, sha256: hash(fs.readFileSync(path.join(directory, file))) };
  });
  // Hash real fixture bytes rather than asking a model to supply a digest.
    task(store, { task_id: 'native_transport', inputs: refs });
    const a = beginAttempt(store, 'native_transport', 'local', 1, 'grade-fixture').attempt;
    store.transaction((s) => { s.attempts[a.attempt_id].native = { terminal_status: 'completed' }; });
    finishAttempt(store, a.attempt_id, { status: 'completed', result: { task_id: a.task_id, task_revision: a.task_revision, attempt_id: a.attempt_id,
      protocol_version: a.protocol_version, status: 'completed', summary: '{"count":3,"missing":1,"sum":12,"mean":4}', artifacts: [], evidence_refs: refs,
      checks: [{ name: 'oracle', passed: true, details: 'Local fixture only' }], limitations: [], unresolved: [],
      usage: { input_tokens: 10, output_tokens: 10, cached_input_tokens: 0, cost_usd: 0 } } });
    assert.equal(gradeNativeAcceptance(directory).passed, true);
    fs.writeFileSync(path.join(directory, 'values.csv'), 'changed');
    assert.equal(gradeNativeAcceptance(directory).passed, false);
});

test('lost turn submission reply remains unknown and retains reservation without automatic retry', async (t) => {
  const { store } = nativeFixture(t);
  task(store, { backend: 'native', objective: 'lose reply fixture' });
  const result = await runTask(store, 'review_scope', 'local', 1, 'lost-submit');
  assert.equal(result.observed_state, 'unknown');
  assert.equal(result.settled, false);
  assert.equal(result.native.phase, 'unknown');
  assert.equal(Object.keys(store.read().attempts).length, 1);
});

test('native writable permissions cannot bypass shared workspace writer admission', (t) => {
  const { loaded } = nativeFixture(t);
  loaded.config.backends.native.sandbox = 'workspace-write';
  assert.throws(() => resolveTask(loaded.config, spec({ backend: 'native', writes_workspace: false })), /writes_workspace/);
});

test('native inspection is read-only and cannot infer that unknown side effects stopped', async (t) => {
  const { loaded, directory } = nativeFixture(t);
  const result = await inspectCodex(loaded.config.backends.native, { thread_id: 'fixture-thread', turn_id: 'fixture-turn' }, directory);
  assert.equal(result.inference_started, false);
  assert.equal(result.can_release_reservation, false);
  assert.equal(result.native_status.type, 'notLoaded');
});

test('control polling no longer rewrites heartbeat state on every tick', async (t) => {
  const { store } = nativeFixture(t);
  let heartbeatChanges = 0;
  const transaction = store.transaction.bind(store);
  store.transaction = (fn) => transaction((state) => {
    const before = JSON.stringify(Object.values(state.assignments).map((a) => a.heartbeat_at));
    const result = fn(state);
    const after = JSON.stringify(Object.values(state.assignments).map((a) => a.heartbeat_at));
    if (before !== after && before !== '[]') heartbeatChanges++;
    return result;
  });
  task(store, { mock: { duration_ms: 450 } });
  await runTask(store, 'review_scope', 'local', 1, 'polling');
  assert.equal(heartbeatChanges, 0);
});

test('orchestrator frontier can select completed history explicitly without loading unrelated tasks', (t) => {
  const { store } = nativeFixture(t);
  task(store, { task_id: 'one' }); task(store, { task_id: 'two' });
  const c = buildOrchestratorContext(store.read(), 'analysis', { taskIds: ['one'] });
  assert.deepEqual(Object.keys(c.packet.tasks), ['one']);
  assert.deepEqual(c.packet.selection.omitted_tasks, ['two']);
  assert.throws(() => buildOrchestratorContext(store.read(), 'analysis', { taskIds: ['unknown'] }), /Unknown/);
});

test('native acceptance preparation is pending, source-pinned, cost-explicit and cannot dispatch before human confirmation', async (t) => {
  const { directory, configFile } = nativeFixture(t);
  assert.throws(() => prepareNativeAcceptance({ directory: path.join(directory, 'missing-cost'), configFile }), /Explicit/);
  const prepared = prepareNativeAcceptance({ directory: path.join(directory, 'acceptance'), configFile, maxCostUsd: 1, reservationCostUsd: 0.01 });
  assert.equal(prepared.executed, false);
  const { Store } = await import('../src/store.mjs');
  const store = new Store(prepared.directory);
  try {
    assert.equal(Object.keys(store.read().attempts).length, 0);
    assert.equal(store.read().benchmarks.requests[prepared.request_id].status, 'pending');
    assert.throws(() => beginAttempt(store, 'native_transport', 'local', 1, 'blocked-benchmark'), /approval|approved|confirmation/i);
    assert.equal(gradeNativeAcceptance(prepared.directory).passed, false);
  } finally { store.close(); }
});
