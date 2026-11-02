import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, spec } from './helpers.mjs';
import { contract, validate } from '../src/schema.mjs';
import { resolveTask } from '../src/config.mjs';
import { buildContext, buildOrchestratorContext } from '../src/context.mjs';
import { registerTask, requestDecision, answerDecision, beginAttempt, control } from '../src/engine.mjs';
import { confined } from '../src/util.mjs';

test('strict contracts reject unknown fields, invalid budgets and invalid IDs', () => {
  assert.throws(() => contract('task', spec({ task_id: '../escape' })), /format/);
  assert.throws(() => contract('task', spec({ surprise: true })), /unknown/);
  assert.throws(() => contract('task', JSON.parse(JSON.stringify(spec()).replace('"task_id":', '"constructor": true, "task_id":'))), /unknown/);
  assert.throws(() => contract('task', spec({ budget: { max_attempts: -1 } })), /required|minimum/);
  assert.throws(() => validate({ type: 'string', unknownKeyword: true }, 'x'), /Unsupported/);
});
test('orchestrator context provides ownership and handoff references without loading all skills', (t) => {
  const { store } = fixture(t);
  registerTask(store, spec());
  const packet = buildOrchestratorContext(store.read());
  assert.equal(packet.packet.position, 'orchestrator');
  assert.equal(packet.packet.owner.epoch, 1);
  assert.equal(packet.packet.tasks.review_scope.status, 'queued');
  assert.equal(packet.packet.active_skills, undefined);
});
test('role/backend overrides are scoped and capabilities fail closed', (t) => {
  const { loaded } = fixture(t);
  const original = spec();
  const result = resolveTask(loaded.config, original, { role: 'evaluator', skills: ['research-evaluate'], backend: 'mock' });
  assert.equal(result.role, 'evaluator');
  assert.equal(original.role, 'researcher');
  assert.throws(() => resolveTask(loaded.config, original, { project: 'escape' }), /override/);
  assert.throws(() => resolveTask(loaded.config, { ...original, backend: 'codex', capabilities: ['steer'] }), /Unsupported capability/);
});
test('context loads only selected skills and detects hash changes', (t) => {
  const { loaded, directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'evidence.txt'), 'negative result');
  const task = resolveTask(loaded.config, spec({ inputs: [{ path: 'evidence.txt', include: true }] }));
  const packet = buildContext(loaded.config, task);
  assert.equal(packet.packet.active_skills.length, 1);
  assert.equal(packet.packet.active_skills[0].name, 'research-scope');
  assert.match(packet.text, /negative result/);
  const sha256 = packet.packet.inputs[0].sha256;
  fs.writeFileSync(path.join(directory, 'evidence.txt'), 'changed');
  task.inputs[0].sha256 = sha256;
  assert.throws(() => buildContext(loaded.config, task), /Input changed/);
});
test('context limits fail without silently discarding evidence', (t) => {
  const { loaded } = fixture(t);
  const task = resolveTask(loaded.config, spec());
  loaded.config.context.max_chars = 10;
  assert.throws(() => buildContext(loaded.config, task), /Context exceeds/);
});
test('paths cannot escape the workspace', (t) => {
  const { directory } = fixture(t);
  assert.throws(() => confined(directory, '../config.json'), /escapes/);
});
test('human decision blocks only its tasks, approval persists for its revision', (t) => {
  const { store } = fixture(t);
  registerTask(store, spec({ required_actions: ['change_main_question'] }));
  registerTask(store, spec({ task_id: 'independent' }));
  requestDecision(store, { decision_id: 'decision1', question: 'Approve question change?', reason: 'Outside existing scope',
    options: [{ label: 'Approve', impact: 'Change question' }], recommendation: 'Review first',
    affected_tasks: ['review_scope'], task_revisions: { review_scope: 1 }, grant_actions: ['change_main_question'] });
  assert.equal(store.read().tasks.review_scope.status, 'waiting_for_user');
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'blocked'), /dispatchable|decision/);
  const independent = beginAttempt(store, 'independent', 'local', 1, 'independent-key');
  assert.equal(independent.duplicate, false);
  control(store, { event_id: 'stop-independent', action: 'cancel', target: 'independent', payload: {} });
  answerDecision(store, 'decision1', 'approve');
  assert.equal(store.read().tasks.review_scope.status, 'queued');
  assert.equal(beginAttempt(store, 'review_scope', 'local', 1, 'approved').duplicate, false);
});
test('silence and status requests do not answer pending decisions', (t) => {
  const { store } = fixture(t);
  registerTask(store, spec());
  requestDecision(store, { decision_id: 'decision2', question: 'Choose?', reason: 'User preference',
    options: [], recommendation: 'Review', affected_tasks: ['review_scope'], task_revisions: { review_scope: 1 }, grant_actions: [] });
  control(store, { event_id: 'status1', action: 'status', target: 'project', payload: {} });
  assert.equal(store.read().decisions.decision2.status, 'pending');
  assert.equal(store.read().tasks.review_scope.status, 'waiting_for_user');
});
