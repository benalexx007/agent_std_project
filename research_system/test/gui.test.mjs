import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, task, spec, resultFor } from './helpers.mjs';
import { Store } from '../src/store.mjs';
import { upgradeGui, checkedAttachment } from '../src/gui-state.mjs';
import { GuiService } from '../src/gui-service.mjs';
import { proposeGuiChange, applyGuiChange, confirmGuiChange, mergePatch } from '../src/gui-changes.mjs';
import { prepareNativeWork, observeNativeWork } from '../src/gui-work.mjs';
import { handoff, takeOwnership, beginAttempt, finishAttempt } from '../src/engine.mjs';
import { fileHash, hash } from '../src/util.mjs';
import { inspectProject } from '../src/inspection.mjs';
import { connectGui, disconnectGui } from '../src/gui-connect.mjs';
import { GUI_ACTIONS, GUI_DATA_FIELDS } from '../src/gui-service.mjs';
import { main } from '../scripts/harness.mjs';
import { record, feedback, rawArtifact } from './research-fixtures.mjs';
import { recordResearch, recordRef } from '../src/research.mjs';
import { activateImprovement } from '../src/improvements.mjs';

function setup(t, modify) {
  const f = fixture(t, modify); upgradeGui(f.store);
  const service = new GuiService(f.store), auth = service.attach({ host: 'codex', surface: 'desktop' });
  return { ...f, service, auth, call: (group, action, data = {}) => service.call(auth, { group, action, data }) };
}
test('GUI migration backs up v4, preserves history and blocks old writers and downgrade', (t) => {
  const { store, directory } = fixture(t); task(store);
  const prior = store.read(); const migrated = upgradeGui(store);
  assert.equal(JSON.parse(fs.readFileSync(migrated.backup)).schema_version, 4);
  assert.deepEqual(store.read().tasks, prior.tasks);
  assert.equal(handoff(store.read()).schema_version, 5);
  const old = new DatabaseSync(store.file);
  old.function('harness_writer_version', () => 4);
  assert.throws(() => old.prepare('UPDATE state SET payload=payload WHERE id=1').run(), /compatible/);
  old.close();
  assert.equal(inspectProject({ workspace: directory }).errors.length, 0);
  assert.equal(upgradeGui(store).migrated, false);
});
test('migration refuses active work; attachments fence projects, detach and stale owners', async (t) => {
  const f = fixture(t); task(f.store); beginAttempt(f.store, 'review_scope', 'local', 1, 'active');
  assert.throws(() => upgradeGui(f.store), /active/);
  const a = setup(t), b = setup(t);
  await assert.rejects(b.service.call(a.auth, { group: 'project', action: 'status' }), /binding/);
  takeOwnership(a.store, 'new', 1);
  await assert.rejects(a.call('work', 'register', { task: spec() }), /Stale/);
  const reader = a.service.attach({ host: 'codex', surface: 'desktop', access: 'read' });
  await assert.rejects(a.service.call(reader, { group: 'work', action: 'register', data: { task: spec() } }), /read-only/);
  assert.equal((await a.service.call(reader, { group: 'project', action: 'status' })).revision, 1);
});
test('config preview/apply/CAS/rollback are atomic, versioned and idle attachment never blocks', async (t) => {
  const f = setup(t);
  const first = await f.call('change', 'prepare', { base_revision: 1, patch: { context: { max_chars: 30000 } } });
  const competing = await f.call('change', 'prepare', { base_revision: 1, patch: { context: { max_chars: 32000 } } });
  assert.equal(first.needs_human, false);
  await f.call('change', 'apply', { change_id: first.change_id });
  assert.equal(f.store.read().config.context.max_chars, 30000);
  assert.equal((await f.call('change', 'apply', { change_id: first.change_id })).duplicate, true);
  await assert.rejects(f.call('change', 'apply', { change_id: competing.change_id }), /conflict/);
  const back = await f.call('change', 'rollback', { revision: 1 });
  await f.call('change', 'apply', { change_id: back.change_id });
  assert.equal(f.store.read().gui.revision, 3); assert.equal(f.store.read().config.context.max_chars, 24000);
  assert.equal(mergePatch({ a: [1], b: 3 }, { a: [2], b: null }).b, undefined);
  assert.throws(() => mergePatch({}, JSON.parse('{"__proto__":{"x":1}}')), /Unsafe/);
});
test('protected change requires exact human path; active work defers normal change and preserves frozen config', async (t) => {
  const f = setup(t); task(f.store);
  const protectedChange = proposeGuiChange(f.store, f.auth, { base_revision: 1, patch: { execution: { max_tokens: 100001 } } });
  assert.throws(() => applyGuiChange(f.store, f.auth, protectedChange.change_id), /human/);
  assert.throws(() => confirmGuiChange(f.store, { change_id: protectedChange.change_id, digest: 'bad', source: 'human_cli', statement: 'Approve' }), /mismatch/);
  confirmGuiChange(f.store, { change_id: protectedChange.change_id, digest: protectedChange.digest, source: 'human_cli', statement: 'Approve this exact limit' });
  applyGuiChange(f.store, f.auth, protectedChange.change_id);
  const change = proposeGuiChange(f.store, f.auth, { base_revision: 2, patch: { context: { max_chars: 35000 } } });
  const a = beginAttempt(f.store, 'review_scope', 'local', 1, 'frozen').attempt;
  const frozen = f.store.read().attempts[a.attempt_id].config_hash;
  assert.equal(applyGuiChange(f.store, f.auth, change.change_id).status, 'deferred');
  finishAttempt(f.store, a.attempt_id, { status: 'failed', not_dispatched: true, error: 'fixture' });
  applyGuiChange(f.store, f.auth, change.change_id);
  assert.equal(f.store.read().attempts[a.attempt_id].config_hash, frozen);
  await assert.rejects(f.call('decision', 'answer', {}), /Unsupported/);
});
test('native observed work is idempotent, model checked, descendants required and completion validates core result', async (t) => {
  const f = setup(t); task(f.store);
  const prepare = { task_id: 'review_scope', key: 'native', mode: 'subagent', effective: { host: 'codex', model: null, effort: null } };
  const started = await prepareNativeWork(f.store, f.auth, prepare);
  assert.equal((await prepareNativeWork(f.store, f.auth, prepare)).duplicate, true);
  assert.equal(f.store.read().attempts[started.attempt_id].observed_state, 'unknown');
  await observeNativeWork(f.store, f.auth, { attempt_id: started.attempt_id, event_id: 'running', state: 'running', handle: 'host-child-1' });
  const evidenceFile = path.join(f.directory, 'terminal.txt'); fs.writeFileSync(evidenceFile, 'Fixture terminal receipt, no live host call');
  const a = f.store.read().attempts[started.attempt_id];
  const terminal = { attempt_id: a.attempt_id, event_id: 'stop', state: 'completed', handle: 'host-child-1', result: resultFor(a),
    descendants_terminal: true, evidence: [{ path: 'terminal.txt', sha256: fileHash(evidenceFile) }] };
  await assert.rejects(observeNativeWork(f.store, f.auth, { ...terminal, descendants_terminal: false }), /descendant/);
  const outcome = await observeNativeWork(f.store, f.auth, terminal);
  assert.equal(outcome.result.validity, 'current');
  assert.equal((await observeNativeWork(f.store, f.auth, terminal)).duplicate, true);
  assert.equal(f.store.read().tasks.review_scope.status, 'completed');
  assert.equal(f.store.read().attempts[a.attempt_id].usage_basis.tokens, 'reservation_estimate');
  assert.equal(f.store.read().attempts[a.attempt_id].gui_provider.reported_result.usage.input_tokens, 10);
});
test('project entries coexist across three hosts, reject modifications and uninstall preserves state', (t) => {
  const f = setup(t), before = f.store.read();
  for (const host of ['codex', 'claude', 'antigravity']) {
    const connected = connectGui(f.directory, host);
    assert.equal(connected.loader_verified, false);
    assert.deepEqual(connectGui(f.directory, host).files, connected.files);
  }
  const skill = path.join(f.directory, '.agents/skills/research-project/SKILL.md'), original = fs.readFileSync(skill, 'utf8');
  fs.appendFileSync(skill, '\nUser customization');
  assert.throws(() => connectGui(f.directory, 'codex'), /conflict/);
  assert.throws(() => disconnectGui(f.directory, 'codex'), /preserved/);
  fs.writeFileSync(skill, original);
  for (const host of ['codex', 'claude', 'antigravity']) assert.equal(disconnectGui(f.directory, host).state_preserved, true);
  assert.deepEqual(f.store.read(), before);
});
test('managed GUI operation survives caller return; replay never submits a second worker', async (t) => {
  const f = setup(t); task(f.store);
  const op = await f.call('work', 'dispatch', { task_id: 'review_scope', key: 'async-mock' });
  assert.equal(op.credential, undefined);
  assert.equal(handoff(f.store.read()).gui.operations[op.operation_id].credential, undefined);
  const duplicate = await f.call('work', 'dispatch', { task_id: 'review_scope', key: 'async-mock' });
  assert.equal(duplicate.operation_id, op.operation_id);
  const deadline = Date.now() + 15000;
  let current;
  while (Date.now() < deadline) {
    current = f.store.read().gui.operations[op.operation_id];
    if (!['submit_intent', 'running'].includes(current.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(current.state, 'completed', JSON.stringify(current));
  assert.equal(Object.keys(f.store.read().attempts).length, 1);
  assert.equal(f.store.read().tasks.review_scope.status, 'completed');
  assert.equal(inspectProject({ workspace: f.directory }).sections.runtime.tasks.rows[0].revision, 1);
  // The core schema accepts the original task shape; use an unresolved fixture.
  await f.call('work', 'revise', { task: spec({ task_revision: 2 }) });
  await assert.rejects(f.call('work', 'dispatch', { task_id: 'review_scope', key: 'async-mock' }), /changed task\/revision/);
});
test('submit intents defer changes until explicit launcher reconciliation; uncertain attempts cannot be erased', async (t) => {
  const f = setup(t); task(f.store);
  const c = await f.call('change', 'prepare', { base_revision: 1, patch: { context: { max_chars: 30000 } } });
  f.store.transaction((s) => { s.gui.operations.lost = { operation_id: 'lost', state: 'submit_intent', dispatch_key: 'lost' }; });
  assert.equal((await f.call('change', 'apply', { change_id: c.change_id })).status, 'deferred');
  await assert.rejects(f.call('work', 'operation_reconcile', { operation_id: 'lost', launcher_terminal: false, evidence: [] }), /evidence/);
  const receipt = path.join(f.directory, 'terminal.txt'); fs.writeFileSync(receipt, 'Local fixture verifies launcher never spawned');
  await f.call('work', 'operation_reconcile', { operation_id: 'lost', launcher_terminal: true, evidence: [{ path: 'terminal.txt', sha256: fileHash(receipt) }] });
  assert.equal((await f.call('change', 'apply', { change_id: c.change_id })).status, 'applied');
});
test('native mode conflicts, cancellation and terminal replay preserve control and reservations', async (t) => {
  const f = setup(t); task(f.store);
  const data = { task_id: 'review_scope', key: 'native-control', mode: 'inline', effective: { host: 'codex', model: null, effort: null } };
  assert.equal((await f.call('work', 'native_assess', { task_id: data.task_id, effective: data.effective, requirements: { hard_budget: true } })).eligible, false);
  const { attempt_id: aid } = await f.call('work', 'native_prepare', data);
  await assert.rejects(f.call('work', 'native_prepare', { ...data, mode: 'subagent' }), /changed mode/);
  await f.call('work', 'control', { action: 'cancel', task_id: data.task_id });
  const a = f.store.read().attempts[aid];
  const receipt = path.join(f.directory, 'terminal.txt'); fs.writeFileSync(receipt, 'Native fixture has no actual descendants');
  const terminal = { attempt_id: aid, event_id: 'terminal', state: 'completed', handle: 'native-child', result: resultFor(a), descendants_terminal: true,
    evidence: [{ path: 'terminal.txt', sha256: fileHash(receipt) }] };
  await assert.rejects(f.call('work', 'native_observe', terminal), /Cancelled/);
  assert.equal(f.store.read().attempts[aid].settled, false);
  delete terminal.result; terminal.state = 'cancelled';
  await f.call('work', 'native_observe', terminal);
  assert.equal(f.store.read().tasks.review_scope.status, 'cancelled');
  assert.equal(f.store.read().attempts[aid].settled, true);
  await assert.rejects(f.call('work', 'native_observe', { attempt_id: aid, event_id: 'late', state: 'running', handle: 'native-child' }), /settled/);
  const invalid = setup(t); task(invalid.store);
  task(invalid.store, { task_id: 'telemetry_task', capabilities: ['live_usage'] });
  assert.equal((await invalid.call('work', 'native_assess', { task_id: 'telemetry_task', effective: data.effective })).eligible, false);
  const rejected = await invalid.call('work', 'native_prepare', data);
  fs.writeFileSync(path.join(invalid.directory, 'terminal.txt'), 'Invalid-result provider tree is terminal');
  const bad = resultFor(invalid.store.read().attempts[rejected.attempt_id]); delete bad.checks;
  await assert.rejects(invalid.call('work', 'native_observe', { attempt_id: rejected.attempt_id, event_id: 'bad', state: 'completed', handle: 'bad-result-child', result: bad,
    descendants_terminal: true, evidence: [{ path: 'terminal.txt', sha256: fileHash(path.join(invalid.directory, 'terminal.txt')) }] }), /checks/);
  assert.equal(invalid.store.read().attempts[rejected.attempt_id].settled, true);
  assert.equal(invalid.store.read().tasks.review_scope.status, 'failed');
});
test('bounded reads, response references, strict catalog and redacted error logs', async (t) => {
  const f = setup(t);
  for (const [group, actions] of Object.entries(GUI_ACTIONS)) for (const action of actions) assert.ok(GUI_DATA_FIELDS[group + '.' + action]);
  const c = await main(['gui-catalog']); assert.equal(c.actions.work.includes('dispatch'), true);
  await assert.rejects(f.call('work', 'dispatch', { task_id: 'x', key: 'k', approved: true }), /unknown/);
  await assert.rejects(f.call('project', 'observe', { key: '__proto__', kind: 'build', source: 'fixture', value: 'x' }), /identifier/);
  await assert.rejects(f.call('work', 'prepare', { task_id: 'api_key=do-not-log-this' }), /Unknown/);
  const errors = fs.readFileSync(path.join(f.directory, '.agentic/logs/gui-errors.jsonl'), 'utf8');
  assert.ok(!errors.includes('do-not-log-this')); assert.ok(errors.includes('correlation'));
  const large = await f.call('project', 'observe', { key: 'large', kind: 'fixture', source: 'fixture', value: 'x'.repeat(26000) });
  assert.equal(large.oversized, true);
  const page = await f.call('evidence', 'read', { root: 'workspace', path: large.path, max_bytes: 100 });
  assert.equal(page.next_offset_bytes, 100);
  assert.equal(page.sha256, large.sha256);
});
test('transaction authorization is rechecked after an async owner takeover', async (t) => {
  const f = setup(t);
  await f.store.withWriteGuard(() => checkedAttachment(f.store, f.auth, true), async () => {
    // Emulate another process taking ownership between read validation and write.
    const other = new Store(f.directory);
    try { takeOwnership(other, 'replacement', 1); } finally { other.close(); }
    await Promise.resolve();
    assert.throws(() => f.store.transaction((s) => { s.gui.revision++; }), /Stale/);
  });
  assert.equal(f.store.read().gui.revision, 1);
});
test('config and immutable overlay activate together; tampering cannot leave partial activation', async (t) => {
  const f = setup(t); task(f.store);
  const note = rawArtifact(f.directory, 'overlay-review.txt', 'Deterministic overlay fixture review'), replacement = rawArtifact(f.directory, 'replacement.md', '# Researcher\nVerified fixture overlay');
  const entry = recordResearch(f.store, record('feedback', 'gui_feedback', { ...feedback(), config_hash: f.store.read().config_hash }), 'local', 1);
  const overlay = await f.call('change', 'overlay', { change_id: 'gui_overlay', reason: 'Fixture change', feedback_refs: [recordRef(entry)],
    files: [{ target: 'domains/research/roles/researcher.md', ...replacement }], checks: [{ name: 'Local review', passed: true, evidence: [note] }] });
  const c = await f.call('change', 'prepare', { base_revision: 1, patch: { context: { max_chars: 30000 } }, overlay: overlay.change_id });
  const file = path.join(f.directory, overlay.files[0].path), original = fs.readFileSync(file);
  fs.writeFileSync(file, 'Tampered overlay');
  await assert.rejects(f.call('change', 'apply', { change_id: c.change_id }), /hash mismatch/);
  assert.equal(f.store.read().config.context.max_chars, 24000); assert.equal(f.store.read().improvements.active, null);
  fs.writeFileSync(file, original);
  await f.call('change', 'apply', { change_id: c.change_id });
  assert.equal(f.store.read().improvements.active, 'gui_overlay'); assert.equal(f.store.read().gui.revision, 2);
  assert.throws(() => activateImprovement(f.store, 'original', 'local', 1), /versioned/);
  const back = await f.call('change', 'rollback', { revision: 1 });
  await f.call('change', 'apply', { change_id: back.change_id });
  assert.equal(f.store.read().improvements.active, null); assert.equal(f.store.read().config.context.max_chars, 24000);
});
test('GUI evidence boundaries, bounded response and unknown inventory survive restart', async (t) => {
  const f = setup(t);
  await assert.rejects(f.call('evidence', 'read', { path: '.agentic/state.sqlite', root: 'workspace' }), /Invalid/);
  await assert.rejects(f.call('evidence', 'read', { path: '../outside', root: 'workspace' }), /Invalid/);
  await assert.rejects(f.call('evidence', 'read', { path: '.research-environment/environment.json', root: 'bundle' }), /public guidance/);
  await assert.rejects(f.call('work', 'register', { task: spec({ inputs: [{ path: '.agentic/state.sqlite', include: true }] }) }), /Invalid execution/);
  assert.equal((await f.call('capability', 'list')).sections.capabilities.gui_inventory.status, 'unknown');
  await f.call('project', 'observe', { key: 'host-build', kind: 'build', source: 'fixture', value: 'x' });
  const other = new Store(f.directory);
  let response; try { response = await new GuiService(other).call(f.auth, { group: 'project', action: 'status' }); } finally { other.close(); }
  assert.equal(response.project.id, f.store.read().project.id);
  const registered = await main(['validate-config', '--workspace', f.directory]);
  assert.equal(registered.config_hash, f.store.read().config_hash);
  const impostor = setup(t);
  impostor.store.transaction((s) => { s.project.workspace = f.directory; });
  await assert.rejects(impostor.call('project', 'status'), /snapshot workspace/);
  assert.throws(() => impostor.service.attach({ host: 'codex', surface: 'desktop' }), /snapshot workspace/);
  await assert.rejects(f.call('project', 'observe', { key: 'host-build', kind: 'build', source: 'fixture', value: 'y' }), /conflict/);
  assert.equal(hash(JSON.stringify(f.store.read().gui.observations)).length, 64);
});
