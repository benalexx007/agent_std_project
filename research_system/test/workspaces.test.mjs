import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, task, resultFor } from './helpers.mjs';
import { beginAttempt, finishAttempt, currentTaskResult, takeOwnership, handoff, control } from '../src/engine.mjs';
import { prepareWorkspace, workspacePath } from '../src/workspaces.mjs';
import { completeAttempt, recoverPublication } from '../src/publication.mjs';
import { saveCheckpoint, loadCheckpoint } from '../src/checkpoints.mjs';
import { runTask } from '../src/runner.mjs';
import { nativeToolHandler } from '../src/native-tools.mjs';
import { contract } from '../src/schema.mjs';
import { fileHash, ROOT } from '../src/util.mjs';

function setup(t, change = () => {}) {
  return fixture(t, (c) => {
    c.workspace_policy = { mode: 'snapshot_directory', include: [], max_files: 100, max_bytes: 8 * 1024 * 1024, max_writers: 2 };
    c.execution.max_concurrent = 3; c.context.max_chars = 96000;
    change(c);
  });
}
async function start(store, tid = 'review_scope', outputs = ['out.txt'], extra = {}) {
  task(store, { task_id: tid, writes_workspace: true, expected_artifacts: outputs, ...extra });
  const { attempt } = beginAttempt(store, tid, 'local', 1, tid);
  await prepareWorkspace(store, attempt.attempt_id);
  return store.read().attempts[attempt.attempt_id];
}
function output(a, files) {
  for (const [p, content] of Object.entries(files)) {
    const target = workspacePath(a.workspace.root, p, false);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  }
  return { status: 'completed', result: resultFor(a, { artifacts: Object.keys(files).map((p) => ({ path: p })) }) };
}

test('snapshot roots exclude the control DB, preserve immutable inputs and pin publication bytes', async (t) => {
  const { store, directory } = setup(t);
  fs.writeFileSync(path.join(directory, 'primary.txt'), 'original');
  const a = await start(store, 'review_scope', ['out.txt'], { inputs: [{ path: 'primary.txt', include: true }] });
  assert.notEqual(a.workspace.root, directory);
  assert(!fs.existsSync(path.join(a.workspace.root, '.agentic/state.sqlite')));
  assert.equal(fs.readFileSync(path.join(a.workspace.root, 'primary.txt'), 'utf8'), 'original');
  const result = await completeAttempt(store, a.attempt_id, output(a, { 'out.txt': 'new result' }));
  assert.equal(result.settled, true);
  assert.equal(fs.readFileSync(path.join(directory, 'out.txt'), 'utf8'), 'new result');
  assert.equal(currentTaskResult(store.read(), 'review_scope'), true);
  assert.equal(store.read().publications[result.publication_id].status, 'accepted');
  contract('attempt', result); contract('handoff', handoff(store.read()));
});

test('independent writers publish separately while conflicting baselines preserve the losing candidate', async (t) => {
  const { store, directory } = setup(t);
  fs.writeFileSync(path.join(directory, 'out.txt'), 'base');
  const a = await start(store, 'a'), b = await start(store, 'b');
  task(store, { task_id: 'third', writes_workspace: true });
  assert.throws(() => beginAttempt(store, 'third', 'local', 1, 'third'), /writer capacity/);
  await completeAttempt(store, a.attempt_id, output(a, { 'out.txt': 'A' }));
  await assert.rejects(completeAttempt(store, b.attempt_id, output(b, { 'out.txt': 'B' })), /Publication conflict/);
  assert.equal(fs.readFileSync(path.join(directory, 'out.txt'), 'utf8'), 'A');
  assert(fs.existsSync(path.join(store.directory, 'attempts', b.attempt_id, 'publication-candidate.json')));
  assert.equal(store.read().publication, null);
  assert(!fs.readdirSync(directory).some((p) => p.startsWith('.agentic-publish-')));
  finishAttempt(store, b.attempt_id, { status: 'failed', error: 'Fixture conflict resolved without a model' });
  const c = await start(store, 'independent', ['different.txt']);
  await completeAttempt(store, c.attempt_id, output(c, { 'different.txt': 'C' }));
  assert(currentTaskResult(store.read(), 'a'));
});

test('partial publication is fenced from dispatch and recovers without another worker attempt', async (t) => {
  const { store, directory } = setup(t);
  fs.writeFileSync(path.join(directory, 'one.txt'), 'old1'); fs.writeFileSync(path.join(directory, 'two.txt'), 'old2');
  const a = await start(store, 'review_scope', ['one.txt', 'two.txt']);
  await assert.rejects(completeAttempt(store, a.attempt_id, output(a, { 'one.txt': 'new1', 'two.txt': 'new2' }),
    { afterInstall(i) { if (i === 0) throw new Error('injected crash'); } }), /injected crash/);
  assert.equal(fs.readFileSync(path.join(directory, 'one.txt'), 'utf8'), 'new1');
  assert.equal(fs.readFileSync(path.join(directory, 'two.txt'), 'utf8'), 'old2');
  task(store, { task_id: 'blocked' });
  assert.throws(() => beginAttempt(store, 'blocked', 'local', 1, 'blocked'), /pending publication/);
  assert.equal(store.read().attempts[a.attempt_id].settled, false);
  assert.equal(currentTaskResult(store.read(), 'review_scope'), false);
  const done = recoverPublication(store, 'local', 1);
  assert.equal(done.observed_state, 'completed');
  assert.equal(Object.keys(store.read().attempts).length, 1);
  assert.equal(fs.readFileSync(path.join(directory, 'two.txt'), 'utf8'), 'new2');
  assert.equal(currentTaskResult(store.read(), 'review_scope'), true);
});

test('publication rollback restores baseline but retains reservations until executor reconciliation', async (t) => {
  const { store, directory } = setup(t);
  fs.writeFileSync(path.join(directory, 'one.txt'), 'old');
  const a = await start(store, 'review_scope', ['one.txt', 'new.txt']);
  await assert.rejects(completeAttempt(store, a.attempt_id, output(a, { 'one.txt': 'changed', 'new.txt': 'created' }),
    { afterInstall(i) { if (i === 1) throw new Error('crash'); } }));
  const rolled = recoverPublication(store, 'local', 1, 'rollback');
  assert.equal(rolled.reservation_released, false);
  assert.equal(fs.readFileSync(path.join(directory, 'one.txt'), 'utf8'), 'old');
  assert(!fs.existsSync(path.join(directory, 'new.txt')));
  assert.equal(store.read().attempts[a.attempt_id].observed_state, 'unknown');
  assert.equal(store.read().attempts[a.attempt_id].settled, false);
});

test('recovery refuses third-party edits and stale owners without replacing their bytes', async (t) => {
  const { store, directory } = setup(t);
  const a = await start(store);
  await assert.rejects(completeAttempt(store, a.attempt_id, output(a, { 'out.txt': 'new' }),
    { afterIntent() { throw new Error('crash'); } }));
  fs.writeFileSync(path.join(directory, 'out.txt'), 'external');
  assert.throws(() => recoverPublication(store, 'local', 1), /conflict/);
  assert.throws(() => recoverPublication(store, 'local', 1, 'rollback'), /conflict/);
  takeOwnership(store, 'next', 1);
  assert.throws(() => recoverPublication(store, 'local', 1), /owner/);
  assert.throws(() => recoverPublication(store, 'next', 2), /Stale assignment/);
  assert.equal(fs.readFileSync(path.join(directory, 'out.txt'), 'utf8'), 'external');
});

test('isolated checkpoint artifacts are pinned and rematerialized without publishing partial work', async (t) => {
  const { store, directory } = setup(t);
  const a = await start(store);
  output(a, { 'out.txt': 'partial' });
  const checkpoint = saveCheckpoint(store, a.attempt_id, {
    summary: 'Partial fixture', remaining_actions: ['finish'], artifacts: [{ path: 'out.txt', sha256: fileHash(path.join(a.workspace.root, 'out.txt')) }],
    checks: [], uncertainties: []
  });
  assert(!fs.existsSync(path.join(directory, 'out.txt')));
  const manifest = loadCheckpoint(store.read(), checkpoint.checkpoint_id);
  assert.equal(manifest.artifact_bindings[0].path, 'out.txt');
  fs.writeFileSync(path.join(a.workspace.root, 'out.txt'), 'corrupted later');
  assert.equal(fs.readFileSync(path.join(directory, manifest.artifacts[0].path), 'utf8'), 'partial');
  finishAttempt(store, a.attempt_id, { status: 'failed', error: 'fixture boundary' });
  const b = beginAttempt(store, 'review_scope', 'local', 1, 'resume').attempt;
  await prepareWorkspace(store, b.attempt_id);
  assert.equal(fs.readFileSync(path.join(b.workspace.root, 'out.txt'), 'utf8'), 'partial');
});

test('execution paths reject control aliases, traversal, Windows devices and junctions', async (t) => {
  const { store, directory } = setup(t);
  for (const p of ['../out', '.AGENTIC/state.sqlite', '.git/config', 'dir/../out', 'C:/out', 'NUL.txt', 'dir./out', '.agentic /state.sqlite']) {
    assert.throws(() => workspacePath(directory, p, false), /Invalid/);
  }
  fs.mkdirSync(path.join(directory, 'real'));
  fs.symlinkSync(path.join(directory, 'real'), path.join(directory, 'link'), 'junction');
  assert.throws(() => workspacePath(directory, 'link/out', false), /symlink|junction/);
});

test('snapshot byte caps reject materialization before a worker can run', async (t) => {
  const { store, directory } = setup(t, (c) => { c.workspace_policy.max_bytes = 64; c.workspace_policy.include = ['large.txt']; });
  fs.writeFileSync(path.join(directory, 'large.txt'), 'x'.repeat(65));
  task(store, { writes_workspace: true });
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'size').attempt;
  await assert.rejects(prepareWorkspace(store, a.attempt_id), /max_bytes/);
  assert.equal(store.read().attempts[a.attempt_id].workspace.status, 'reserved');
});

test('preparation failure before spawn settles known zero model usage', async (t) => {
  const { store, directory } = setup(t, (c) => { c.workspace_policy.include = ['large.txt']; c.workspace_policy.max_bytes = 2; });
  fs.writeFileSync(path.join(directory, 'large.txt'), 'too large');
  task(store);
  const failed = await runTask(store, 'review_scope', 'local', 1, 'no-spawn');
  assert.equal(failed.observed_state, 'failed'); assert.equal(failed.job_refs.length, 0);
  assert.equal(failed.accounted_tokens, 0); assert.equal(failed.usage_basis.tokens, 'reported');
});

test('failed spawn transaction cannot hide a possibly launched OS process behind an empty job list', async (t) => {
  const { store } = fixture(t); task(store);
  const original = store.transaction.bind(store);
  let injected = false;
  store.transaction = (fn) => original((s) => {
    const result = fn(s);
    if (!injected && Object.values(s.attempts).some((a) => a.observed_state === 'running' && a.job_refs.length)) {
      injected = true; throw new Error('Injected spawn commit failure');
    }
    return result;
  });
  const unknown = await runTask(store, 'review_scope', 'local', 1, 'spawn-rollback');
  assert.equal(unknown.observed_state, 'unknown');
  assert.equal(unknown.settled, false);
  assert.equal(unknown.job_refs[0].child_coverage, 'unverified');
  assert.equal(unknown.error, 'Injected spawn commit failure');
});

test('v4 migration backs up history, fences old SQLite writers, and blocks active v2 migration', (t) => {
  const { store } = setup(t);
  task(store);
  store.db.exec('DROP TRIGGER writer_generation_guard');
  store.transaction((s) => { s.schema_version = 2; });
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'before'), /[Mm]igrat/);
  const migrated = store.migrate();
  assert.equal(migrated.schema_version, 4); assert(fs.existsSync(migrated.backup));
  assert(store.read().tasks.review_scope);
  const legacy = new DatabaseSync(store.file);
  try { assert.throws(() => legacy.prepare('UPDATE state SET payload=payload WHERE id=1').run(), /harness_writer_version/); }
  finally { legacy.close(); }
  assert.throws(() => store.transaction((s) => { s.schema_version = 2; }), /compatible v4/);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'active').attempt;
  store.db.exec('DROP TRIGGER writer_generation_guard');
  store.transaction((s) => { s.schema_version = 2; });
  assert.throws(() => store.migrate(), /active\/unknown/);
  assert.equal(store.read().attempts[a.attempt_id].settled, false);
});

test('runner supplies separate execution/control roots and validates actual worker-created files', async (t) => {
  const { store, directory } = setup(t, (c) => {
    c.execution.allow_external = true;
    c.backends.writer = { kind: 'command', command: process.execPath, args: [path.join(ROOT, 'test/fixtures/writer.mjs')], allow_execute: true, protocol: 'result-json' };
  });
  task(store, { backend: 'writer', writes_workspace: true, expected_artifacts: ['result.json'] });
  const done = await runTask(store, 'review_scope', 'local', 1, 'writer-run');
  assert.equal(done.observed_state, 'completed', done.error);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));
  assert.equal(path.resolve(report.cwd), done.workspace.root);
  assert.equal(report.control_root, directory);
  assert(!report.control_db_in_execution);
  assert(done.final_checkpoint_id);
});

test('isolated tool reads use the execution baseline and immutable primary changes block acceptance', async (t) => {
  const { store, directory } = setup(t);
  fs.writeFileSync(path.join(directory, 'primary.txt'), 'base');
  const a = await start(store, 'review_scope', ['out.txt'], { inputs: [{ path: 'primary.txt' }] });
  fs.writeFileSync(path.join(directory, 'primary.txt'), 'changed outside');
  const read = await nativeToolHandler(store, a.attempt_id)('harness_read', { path: 'primary.txt', root: 'workspace' }, 'read');
  assert.equal(read.content, 'base');
  await assert.rejects(completeAttempt(store, a.attempt_id, output(a, { 'out.txt': 'result' })), /input changed/);
  assert(!fs.existsSync(path.join(directory, 'out.txt')));
});

test('isolated undeclared artifacts and generated evidence cannot escape publication scope', async (t) => {
  const { store, directory } = setup(t), a = await start(store);
  const candidate = output(a, { 'out.txt': 'okay', 'extra.txt': 'not declared' });
  candidate.result.artifacts[1].sha256 = fileHash(path.join(a.workspace.root, 'extra.txt'));
  await assert.rejects(completeAttempt(store, a.attempt_id, candidate), /not declared/);
  const evidenceCandidate = { ...candidate, result: { ...candidate.result, artifacts: [candidate.result.artifacts[0]],
    evidence_refs: [candidate.result.artifacts[1]] } };
  await assert.rejects(completeAttempt(store, a.attempt_id, evidenceCandidate), /Generated evidence/);
  assert(!fs.existsSync(path.join(directory, 'out.txt')));
  assert.equal(store.read().publication, null);
  assert(!fs.readdirSync(directory).some((p) => p.startsWith('.agentic-publish-')));
});

test('multiple isolated units may update the same logical artifact without invalidating historical receipts', async (t) => {
  const { store, directory } = setup(t);
  const unit = (name, dependencies) => ({ work_unit_id: name, objective: name, dependencies, expected_artifacts: ['report.txt'],
    estimate: { work_tokens: 100, validation_tokens: 0, checkpoint_tokens: 20, margin_tokens: 20, cost_usd: 0, context_growth_tokens: 0 } });
  const a = await start(store, 'review_scope', ['report.txt'], { work_units: [unit('one', []), unit('two', ['one'])] });
  await completeAttempt(store, a.attempt_id, output(a, { 'report.txt': 'first' }));
  const b = beginAttempt(store, 'review_scope', 'local', 1, 'second-unit').attempt;
  await prepareWorkspace(store, b.attempt_id);
  await completeAttempt(store, store.read().attempts[b.attempt_id].attempt_id,
    output(store.read().attempts[b.attempt_id], { 'report.txt': 'second' }));
  assert.equal(fs.readFileSync(path.join(directory, 'report.txt'), 'utf8'), 'second');
  assert.equal(currentTaskResult(store.read(), 'review_scope'), true);
});

for (const action of ['pause', 'cancel']) test(action + ' during snapshot preparation stops before dispatch with zero model usage', async (t) => {
  const { store, directory } = setup(t, (c) => { c.workspace_policy.include = ['source.txt']; });
  fs.writeFileSync(path.join(directory, 'source.txt'), 'snapshot input');
  task(store);
  const running = runTask(store, 'review_scope', 'local', 1, 'preparing');
  control(store, { event_id: 'barrier', action, target: 'review_scope', payload: {} });
  const stopped = await running;
  assert.equal(stopped.observed_state, 'cancelled'); assert.equal(stopped.job_refs.length, 0);
  assert.equal(stopped.accounted_tokens, 0);
  assert.equal(store.read().events.barrier.status, 'verified');
  if (action === 'pause') {
    assert.equal(store.read().tasks.review_scope.status, 'paused');
    control(store, { event_id: 'resume', action: 'resume', target: 'review_scope', payload: {} });
    assert.equal(store.read().tasks.review_scope.status, 'queued');
    assert.equal((await runTask(store, 'review_scope', 'local', 1, 'after-pause')).observed_state, 'completed');
  } else assert.equal(store.read().tasks.review_scope.status, 'cancelled');
});


test('accepted publication recovery reuses journal and actual usage without republishing', async (t) => {
  const { store, directory } = setup(t);
  const a = await start(store);
  let outcome = output(a, { 'out.txt': 'accepted bytes' });
  const accepted = await completeAttempt(store, a.attempt_id, outcome);
  outcome=structuredClone(store.read().publications[accepted.publication_id].outcome);
  // Reproduce post-publication runner corruption while retaining the accepted journal.
  store.transaction(s => { const a=s.attempts[accepted.attempt_id]; a.observed_state='unknown'; a.settled=false; });
  await assert.rejects(completeAttempt(store, a.attempt_id, outcome), /verified recovered/);
  store.transaction(s => { s.attempts[a.attempt_id].recovered_result_termination={trust:'fixture'}; });
  const changed=structuredClone(outcome); changed.result.summary='different';
  await assert.rejects(completeAttempt(store, a.attempt_id, changed), /result changed/);
  fs.writeFileSync(path.join(directory,'out.txt'),'third party');
  await assert.rejects(completeAttempt(store, a.attempt_id, outcome), /output changed/);
  fs.writeFileSync(path.join(directory,'out.txt'),'accepted bytes');
  const done=await completeAttempt(store,a.attempt_id,outcome);
  assert.equal(done.observed_state,'completed'); assert.equal(done.settled,true);
  assert.equal(done.publication_id,accepted.publication_id);
  assert.equal(Object.keys(store.read().publications).length,1);
  assert.deepEqual(done.result.usage,outcome.result.usage);
});
