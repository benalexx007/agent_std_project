import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task, resultFor } from './helpers.mjs';
import { record, feedback, rawArtifact } from './research-fixtures.mjs';
import { recordResearch, recordRef } from '../src/research.mjs';
import { proposeImprovement, activateImprovement } from '../src/improvements.mjs';
import { buildContext } from '../src/context.mjs';
import { beginAttempt, finishAttempt, handoff } from '../src/engine.mjs';
import { saveCheckpoint, loadCheckpoint } from '../src/checkpoints.mjs';
import { hash } from '../src/util.mjs';

function proposal(store, directory, changeId = 'change1') {
  const note = rawArtifact(directory, changeId + '-review.txt', 'Synthetic software review evidence; no model invocation.');
  const replacement = rawArtifact(directory, changeId + '.md', '# Researcher\n\nPreserve boundary assumptions. Synthetic project overlay.\n');
  const f = recordResearch(store, record('feedback', changeId + '_feedback', { ...feedback(), config_hash: store.read().config_hash }), 'local', 1);
  return { change_id: changeId, reason: 'Fixture feedback', feedback_refs: [recordRef(f)], files: [{ target: 'domains/research/roles/researcher.md', ...replacement }],
    checks: [{ name: 'Synthetic source review', passed: true, evidence: [note] }] };
}

test('feedback leads to immutable project overlays with an actual rollback path', (t) => {
  const { store, directory } = fixture(t); task(store);
  const s = store.read(), originalFile = path.join(s.config.bundle_root, 'domains/research/roles/researcher.md');
  const originalHash = hash(fs.readFileSync(originalFile));
  const p = proposal(store, directory);
  const change = proposeImprovement(store, p, 'local', 1);
  assert.equal(store.read().improvements.active, null);
  fs.writeFileSync(path.join(directory, p.files[0].path), 'Edited staging file after proposal');
  activateImprovement(store, 'change1', 'local', 1);
  const current = store.read();
  const packet = buildContext(current.config, current.tasks.review_scope.spec, [], [], current);
  assert.match(packet.packet.role_instructions, /Synthetic project overlay/);
  assert.equal(packet.packet.bundle_refs.find((r) => r.root === 'workspace').sha256, change.files[0].sha256);
  activateImprovement(store, 'original', 'local', 1);
  const rolled = store.read();
  assert.equal(hash(fs.readFileSync(originalFile)), originalHash);
  assert.doesNotMatch(buildContext(rolled.config, rolled.tasks.review_scope.spec, [], [], rolled).packet.role_instructions, /Synthetic project overlay/);
  assert.equal(handoff(rolled).improvements.events.at(-1).previous, 'change1');
});

test('improvements require checked evidence, valid targets and current ownership', (t) => {
  const { store, directory } = fixture(t); task(store);
  const p = proposal(store, directory);
  assert.throws(() => proposeImprovement(store, p, 'old', 1), /owner/);
  assert.throws(() => proposeImprovement(store, { ...p, files: [{ ...p.files[0], target: '../escape.md' }] }, 'local', 1), /overlays/);
  p.checks[0].passed = false;
  proposeImprovement(store, p, 'local', 1);
  assert.throws(() => activateImprovement(store, 'change1', 'local', 1), /failing checks/);
});

test('active work fences bundle activation and immutable overlay tampering is detected', (t) => {
  const { store, directory } = fixture(t); task(store);
  const change = proposeImprovement(store, proposal(store, directory), 'local', 1);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'active-change').attempt;
  assert.throws(() => activateImprovement(store, 'change1', 'local', 1), /active\/unknown/);
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  fs.writeFileSync(path.join(directory, change.files[0].path), 'Tampered immutable overlay');
  assert.throws(() => activateImprovement(store, 'change1', 'local', 1), /hash mismatch/);
});

test('checkpoint policy fingerprints reject a changed overlay and accept explicit rollback', (t) => {
  const { store, directory } = fixture(t); task(store);
  proposeImprovement(store, proposal(store, directory), 'local', 1);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'policy-checkpoint').attempt;
  const saved = saveCheckpoint(store, a.attempt_id, { summary: 'Original policy', remaining_actions: [], artifacts: [], checks: [], uncertainties: [] });
  finishAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  activateImprovement(store, 'change1', 'local', 1);
  assert.throws(() => loadCheckpoint(store.read(), saved.checkpoint_id), /policy changed/);
  activateImprovement(store, 'original', 'local', 1);
  assert.equal(loadCheckpoint(store.read(), saved.checkpoint_id).checkpoint_id, saved.checkpoint_id);
});

test('a fresh improvement version can be activated and rolled back without losing prior versions', (t) => {
  const { store, directory } = fixture(t); task(store);
  proposeImprovement(store, proposal(store, directory, 'v1'), 'local', 1);
  activateImprovement(store, 'v1', 'local', 1);
  proposeImprovement(store, proposal(store, directory, 'v2'), 'local', 1);
  activateImprovement(store, 'v2', 'local', 1);
  activateImprovement(store, 'v1', 'local', 1);
  assert.equal(store.read().improvements.active, 'v1');
  assert.equal(Object.keys(store.read().improvements.changes).length, 2);
});
