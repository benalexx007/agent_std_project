import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task, spec, resultFor } from './helpers.mjs';
import { profile, hypothesis, derivation, experiment, evidence, review, record, rawArtifact } from './research-fixtures.mjs';
import { recordResearch, recordRef, researchEntry, researchValidity, researchReview, renderResearch } from '../src/research.mjs';
import { buildContext } from '../src/context.mjs';
import { resolveTask } from '../src/config.mjs';
import { beginAttempt, finishAttempt, reviseTask, handoff, takeOwnership, control, recordRun } from '../src/engine.mjs';
import { saveCheckpoint, loadCheckpoint } from '../src/checkpoints.mjs';
import { planRecovery } from '../src/recovery.mjs';
import { main } from '../scripts/harness.mjs';

const put = (store, value, aid) => recordResearch(store, value, 'local', 1, aid);
const subject = (entry) => ({ ...recordRef(entry), relation: 'subject' });

test('paper/proof output and scoped profile overrides are independent of role/backend', (t) => {
  const { loaded } = fixture(t);
  const input = spec({ research_profile: profile('paper') });
  const overridden = resolveTask(loaded.config, input, { research_profile: profile('proof') });
  assert.equal(overridden.research_profile.output.format, 'proof');
  assert.equal(input.research_profile.output.format, 'paper');
  assert.equal(overridden.backend, 'mock');
  assert.throws(() => resolveTask(loaded.config, spec({ research_profile: { ...profile(), reasoning_modes: ['mathematical', 'mathematical'] } })), /Duplicate/);
});

test('C1: observations keep historical subjects while a hypothesis evolves', (t) => {
  const { store, directory } = fixture(t); task(store);
  const h1 = put(store, record('hypothesis', 'H1', hypothesis()));
  put(store, record('hypothesis', 'H2', hypothesis('Fixture H2 predicts a flat response')));
  const obs = put(store, record('evidence', 'E1', evidence(), [subject(h1)], [rawArtifact(directory)]));
  const updated = put(store, record('hypothesis', 'H1', { ...hypothesis(), support: 'contradicted', decision: 'Reject within fixture scope' }, [recordRef(obs)], [], { revision: 2 }));
  assert.equal(researchEntry(store.read(), 'H1', 1).sha256, h1.sha256);
  assert.equal(researchValidity(store.read(), obs).current, true);
  assert.equal(researchValidity(store.read(), updated).current, true);
  assert.equal(researchValidity(store.read(), h1).current, false);
  assert.equal(researchEntry(store.read(), 'H2').record.data.support, 'untested');
});

test('dependency changes invalidate derived claims transitively without deleting history', (t) => {
  const { store } = fixture(t); task(store);
  const h = put(store, record('hypothesis', 'H', hypothesis()));
  const d = put(store, record('derivation', 'D', derivation(), [recordRef(h)]));
  const c = put(store, record('claim', 'C', { statement: 'Unconfirmed fixture', scope: 'fixture', support: 'inconclusive', limitations: [] }, [recordRef(d)]));
  put(store, { ...h.record, revision: 2, change_reason: 'Change assumption', data: { ...h.record.data, assumptions: ['different domain'] } });
  const checked = researchReview(store.read());
  assert.equal(checked.records.find((e) => e.record.record_id === 'C').validity.current, false);
  assert.equal(researchEntry(store.read(), 'C').record.data.support, c.record.data.support);
  assert.equal(store.read().research.records.H.length, 2);
});

test('record revisions and owner fences prevent overwrites and stale-worker publication', (t) => {
  const { store } = fixture(t); task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'research-owner').attempt;
  put(store, record('hypothesis', 'H', hypothesis()), a.attempt_id);
  assert.throws(() => put(store, record('hypothesis', 'H', hypothesis())), /revision/);
  takeOwnership(store, 'new-owner', 1);
  assert.throws(() => put(store, record('hypothesis', 'Other', hypothesis()), a.attempt_id), /owner/);
  assert.throws(() => recordResearch(store, record('hypothesis', 'Other', hypothesis()), 'new-owner', 2, a.attempt_id), /Stale assignment/);
});

test('support and novelty cannot be promoted without matching explicit evidence', (t) => {
  const { store } = fixture(t); task(store);
  assert.throws(() => put(store, record('hypothesis', 'H', { ...hypothesis(), support: 'supported' })), /evidence/);
  assert.throws(() => put(store, record('hypothesis', 'H', { ...hypothesis(), novelty: 'candidate_within_search_scope' })), /novelty/);
  assert.throws(() => put(store, record('hypothesis', 'H', { ...hypothesis(), novelty: 'globally_confirmed' })), /schema/);
  assert.equal(Object.keys(store.read().research?.records || {}).length, 0);
});

test('C2: numerical checks and open obligations cannot be labelled as verified proof', (t) => {
  const { store, directory } = fixture(t); task(store);
  const proof = put(store, record('derivation', 'D', derivation()));
  const verification = { kind: 'numerical', reviewer: 'fixture', tool_version: 'fixture-v1', statement_checked: 'x/x = 1', admitted_goals: 0, outcome: 'passed' };
  const next = { ...proof.record, revision: 2, artifacts: [rawArtifact(directory)], data: { ...derivation(), level: 'verified_proof', verification } };
  assert.throws(() => put(store, next), /closed obligations/);
  next.data.open_obligations = [];
  assert.throws(() => put(store, next), /Numerical/);
  next.data.verification = { ...verification, kind: 'formal', admitted_goals: 1 };
  assert.throws(() => put(store, next), /admitted/);
  next.data.verification.admitted_goals = 0;
  const accepted = put(store, next);
  assert.match(accepted.verification_trust, /attestation/);
  assert.match(renderResearch(store.read(), 'review_scope').markdown, /assumptions|x != 0/);
});

test('C3: confirmatory plans need predictions and failed runs are not scientific counterevidence', (t) => {
  const { store, directory } = fixture(t); task(store);
  assert.throws(() => put(store, record('experiment', 'P', { ...experiment(), predictions: [] })), /predictions/);
  put(store, record('experiment', 'P', experiment()));
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'failed-run').attempt;
  finishAttempt(store, a.attempt_id, { status: 'failed', error: 'fixture' });
  const raw = rawArtifact(directory);
  recordRun(store, { run_id: 'run1', attempt_id: a.attempt_id, protocol_version: 'fixture-v1', code_revision: 'fixture', patch_sha256: raw.sha256,
    data_version: 'fixture', config: {}, model_version: null, environment: {}, started_at: 'fixture', ended_at: 'fixture', status: 'failed', outputs: [raw] });
  assert.throws(() => put(store, record('evidence', 'E', evidence(), [], [raw], { run_ids: ['run1'] })), /Failed run/);
  const failed = put(store, record('evidence', 'E', evidence('failed_run'), [], [raw], { run_ids: ['run1'] }));
  assert.throws(() => put(store, record('hypothesis', 'H', { ...hypothesis(), support: 'contradicted' }, [recordRef(failed)])), /matching/);
});

test('contrary evidence is retained and conflicts require a recorded review', (t) => {
  const { store, directory } = fixture(t); task(store);
  const raw = rawArtifact(directory);
  const positive = put(store, record('evidence', 'positive', evidence('supports'), [], [raw]));
  const negative = put(store, record('evidence', 'negative', evidence('contradicts'), [], [raw]));
  const refs = [recordRef(positive), recordRef(negative)];
  assert.throws(() => put(store, record('hypothesis', 'H', { ...hypothesis(), support: 'supported' }, refs)), /Conflicting/);
  const r = put(store, record('review', 'R', review(), refs));
  put(store, record('hypothesis', 'H', { ...hypothesis(), support: 'supported' }, [...refs, recordRef(r)]));
  const text = renderResearch(store.read(), 'review_scope').markdown;
  assert.match(text, /negative/); assert.match(text, /inconclusive/);
});

test('changed artifacts and task revisions make research require review', (t) => {
  const { store, directory } = fixture(t); task(store);
  const artifact = rawArtifact(directory);
  const e = put(store, record('evidence', 'E', evidence(), [], [artifact]));
  fs.writeFileSync(path.join(directory, artifact.path), 'changed');
  assert.equal(researchValidity(store.read(), e).current, false);
  const h = put(store, record('hypothesis', 'H', hypothesis()));
  reviseTask(store, spec({ task_revision: 2, protocol_version: 'v2' }), 'local', 1);
  assert.equal(researchValidity(store.read(), h).current, false);
});

test('targeted context includes reverse counterevidence and cannot silently truncate it', (t) => {
  const { store, directory, loaded } = fixture(t); task(store);
  const h = put(store, record('hypothesis', 'H', hypothesis()));
  put(store, record('evidence', 'E', evidence(), [subject(h)], [rawArtifact(directory)]));
  const s = store.read();
  const selected = { ...s.tasks.review_scope.spec, skills: ['research-design'], research_profile: profile(), research_record_ids: ['H'] };
  const context = buildContext(s.config, selected, [], [], s);
  assert.equal(context.packet.research_guidance.length, 4);
  assert.equal(context.packet.research.records.length, 2);
  assert.match(context.text, /contradicts/);
  loaded.config.context.max_chars = context.characters - 1;
  assert.throws(() => buildContext(loaded.config, selected, [], [], s), /exceeds/);
});

test('small citation tasks do not load discovery references or create extra workers', (t) => {
  const { store } = fixture(t, (c) => { c.research_profile = profile(); }); const value = task(store);
  const context = buildContext(store.read().config, value, [], [], store.read());
  assert.equal(context.packet.research_guidance.length, 0);
  assert.equal(context.packet.active_skills.length, 1);
  assert.equal(Object.keys(store.read().attempts).length, 0);
});

test('C4: checkpoint and handoff preserve pinned obligations through takeover and pause', (t) => {
  const { store } = fixture(t); task(store);
  const d = put(store, record('derivation', 'D', derivation()));
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'checkpoint-A').attempt;
  const c = saveCheckpoint(store, a.attempt_id, { summary: 'Proof unfinished', remaining_actions: ['Check x=0'], artifacts: [], checks: [], uncertainties: ['Boundary condition'] });
  finishAttempt(store, a.attempt_id, { status: 'failed', failure: { reason: 'context_capacity', recoverable: true } });
  const recovery = planRecovery(store, 'review_scope', 'local', 1);
  assert.equal(recovery.status, 'ready');
  control(store, { event_id: 'pause-transfer', action: 'pause', target: 'review_scope', payload: {} });
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'blocked-B', { recoveryId: recovery.recovery_id }), /pause/);
  const saved = loadCheckpoint(store.read(), c.checkpoint_id);
  assert.equal(saved.research_refs[0].sha256, d.sha256);
  assert.deepEqual(handoff(store.read()).research.records.D[0].record.data.open_obligations, ['The original problem also asks about x=0']);
  control(store, { event_id: 'resume-transfer', action: 'resume', target: 'review_scope', payload: {} });
  const b = beginAttempt(store, 'review_scope', 'local', 1, 'worker-B', { recoveryId: recovery.recovery_id });
  assert.equal(b.context.packet.research.records[0].record.data.level, 'proof_sketch');
  assert.throws(() => put(store, record('hypothesis', 'late', hypothesis()), a.attempt_id), /Stale assignment/);
});

test('research namespace stays additive and export works through the v4 CLI', async (t) => {
  const { store, directory, configFile } = fixture(t); task(store);
  assert.equal(store.read().research, undefined);
  const file = path.join(directory, 'record.json'); fs.writeFileSync(file, JSON.stringify(record('hypothesis', 'H', hypothesis())));
  await main(['record-research', '--config', configFile, '--file', file, '--owner', 'local', '--epoch', '1']);
  const output = await main(['export-research', '--config', configFile, '--task', 'review_scope']);
  assert.match(output.markdown, /H r1/);
  assert.equal(store.read().schema_version, 4);
  assert.equal(store.read().research.schema_version, 1);
  const markdownFile = path.join(directory, 'review.md');
  await main(['export-research', '--config', configFile, '--task', 'review_scope', '--format', 'markdown', '--out', markdownFile]);
  assert.match(fs.readFileSync(markdownFile, 'utf8'), /^# Research output/);
});

test('declared inputs and upstream task revisions invalidate research even if raw outputs remain unchanged', (t) => {
  const { store, directory } = fixture(t);
  rawArtifact(directory, 'input.txt', 'Original input');
  task(store, { inputs: [{ path: 'input.txt' }] });
  const h = put(store, record('hypothesis', 'H', hypothesis()));
  task(store, { task_id: 'child', dependencies: ['review_scope'] });
  const child = put(store, record('derivation', 'D', derivation(), [], [], { task_id: 'child' }));
  fs.writeFileSync(path.join(directory, 'input.txt'), 'Input drift');
  assert.equal(researchValidity(store.read(), h).current, false);
  assert.equal(researchValidity(store.read(), child).current, false);
  fs.writeFileSync(path.join(directory, 'input.txt'), 'Original input');
  reviseTask(store, spec({ task_revision: 2, protocol_version: 'new-protocol' }), 'local', 1);
  assert.equal(researchValidity(store.read(), child).current, false);
});

test('unknown workers cannot publish and snapshots detect corrupted pinned records', (t) => {
  const { store } = fixture(t); task(store);
  const h = put(store, record('hypothesis', 'H', hypothesis()));
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'unknown-research').attempt;
  store.transaction((s) => { s.attempts[a.attempt_id].observed_state = 'unknown'; });
  assert.throws(() => put(store, record('hypothesis', 'late', hypothesis()), a.attempt_id), /Stale assignment/);
  assert.throws(() => put(store, record('derivation', 'D', derivation(), [{ ...recordRef(h), sha256: 'a'.repeat(64) }])), /hash mismatch/);
  assert.throws(() => researchEntry(store.read(), 'H', 0), /Invalid research revision/);
  assert.throws(() => researchReview(store.read(), 'not_a_task'), /Unknown/);
});

test('historical subject references cannot bypass evidence dependency invalidation', (t) => {
  const { store, directory } = fixture(t); task(store);
  const e = put(store, record('evidence', 'E', evidence('supports'), [], [rawArtifact(directory)]));
  const data = { statement: 'Fixture conclusion', scope: 'fixture', support: 'supported', limitations: [] };
  assert.throws(() => put(store, record('claim', 'C', data, [subject(e)])), /dependency evidence/);
  const c = put(store, record('claim', 'C', data, [recordRef(e)]));
  put(store, { ...e.record, revision: 2, change_reason: 'Reinterpret fixture', data: evidence('inconclusive') });
  assert.equal(researchValidity(store.read(), c).current, false);
});
