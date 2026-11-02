import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture, spec, task, resultFor } from './helpers.mjs';
import { resolveTask } from '../src/config.mjs';
import { contract } from '../src/schema.mjs';
import { ROOT, readJSON } from '../src/util.mjs';
import { modelForBackend, selectModel, orchestratorModel, validateModelPolicy } from '../src/models.mjs';
import { invocation } from '../adapters/index.mjs';
import { beginAttempt, finishAttempt } from '../src/engine.mjs';
import { buildOrchestratorContext } from '../src/context.mjs';
import { main } from '../scripts/harness.mjs';

test('the three requested Codex task classes resolve the exact model and effort pair', (t) => {
  const { loaded } = fixture(t);
  for (const [task_class, tier, model, effort] of [
    ['synthesis_planning','highest','gpt-6-astra','high'], ['analysis','medium','gpt-6.1-sol','high'], ['automation','low','gpt-6.1-sol','medium']
  ]) {
    const selected = resolveTask(loaded.config, spec({ backend: 'codex', task_class }));
    assert.equal(selected.model_tier, tier);
    assert.equal(selected.model, model);
    assert.equal(selected.reasoning_effort, effort);
    assert.equal(selected.role, 'researcher');
    assert.equal(selected.model_selection.source, 'tier');
    assert.equal(loaded.config.backends.codex.allow_execute, false);
  }
});

test('orchestration defaults to analysis while a separate scientific advisor uses the highest tier', (t) => {
  const { loaded, store } = fixture(t);
  assert.equal(resolveTask(loaded.config, spec({ backend: 'codex' })).reasoning_effort, 'high');
  const coordinator = buildOrchestratorContext(store.read());
  assert.equal(coordinator.packet.model, 'gpt-6.1-sol');
  assert.equal(coordinator.packet.reasoning_effort, 'high');
  assert.equal(coordinator.packet.model_selection.task_class, 'analysis');
  assert.equal(coordinator.packet.backend, 'manual');
  assert.equal(coordinator.packet.planning_requirements, undefined);
  const advisor = resolveTask(loaded.config, readJSON(path.join(ROOT, 'examples/task-synthesis-planning.json')));
  assert.equal(advisor.role, 'researcher');
  assert.equal(advisor.model, 'gpt-6-astra');
  assert.equal(advisor.model_tier, 'highest');
  assert.equal(advisor.reasoning_effort, 'high');
  assert.equal(buildOrchestratorContext(store.read()).packet.model, 'gpt-6.1-sol');
  const tierOnly = resolveTask(loaded.config, spec({ backend:'codex', model_tier:'highest' }));
  assert.equal(tierOnly.model_selection.task_class, 'synthesis_planning');
  loaded.config.orchestrator.model_tier='low';
  assert.equal(orchestratorModel(loaded.config).model_selection.task_class,'automation');
});

test('all shipped model-policy presets and the headless coordinator example default to analysis', () => {
  for (const file of ['research.json', 'recovery.json', 'research-paper.json', 'research-isolated.json',
    'research-extensions.json', 'codex-native.json', 'codex-native-extensions.json']) {
    // Selection/schema regression only; provisioning and environment hashes have separate checks.
    const config = contract('config', readJSON(path.join(ROOT, 'examples', file)));
    validateModelPolicy(config);
    const selected = orchestratorModel(config);
    assert.equal(selected.model_selection.task_class, 'analysis', file);
    assert.equal(selected.model, 'gpt-6.1-sol', file);
    assert.equal(selected.reasoning_effort, 'high', file);
    assert.equal(config.execution.allow_external, false, file);
    assert.equal(config.model_policy.task_class_backends.automation, 'antigravity', file);
    assert.equal(selectModel(config,{backend:config.model_policy.task_class_backends.automation,task_class:'automation'}).model,
      'gemini-3.8-flash-high',file);
    if (config.roles.orchestrator) {
      const request = readJSON(path.join(ROOT, 'examples/task-orchestrator.json'));
      assert.equal(request.task_class, 'analysis', file);
      const coordinator = selectModel(config, request);
      assert.equal(coordinator.model_selection.task_class, 'analysis', file);
      assert.equal(coordinator.model_tier, 'medium', file);
    }
  }
});

test('explicit orchestrator selections retain precedence without changing worker or advisor policy', (t) => {
  const { loaded } = fixture(t);
  loaded.config.orchestrator.task_class = 'automation';
  assert.equal(orchestratorModel(loaded.config).reasoning_effort, 'medium');
  const preview = orchestratorModel(loaded.config, 'analysis');
  assert.equal(preview.reasoning_effort, 'high');
  assert.equal(loaded.config.orchestrator.task_class, 'automation');
  delete loaded.config.orchestrator.task_class;
  loaded.config.orchestrator.model = 'explicit-coordinator-model';
  assert.equal(orchestratorModel(loaded.config).model, 'explicit-coordinator-model');
  assert.equal(resolveTask(loaded.config, spec({ backend:'codex' })).model_selection.task_class, 'analysis');
  assert.equal(resolveTask(loaded.config, spec({ backend:'codex', task_class:'synthesis_planning' })).model, 'gpt-6-astra');
});

test('Codex invocation passes effort as a real configuration argument rather than prompt text', (t) => {
  const { loaded } = fixture(t);
  for (const task_class of ['synthesis_planning', 'automation']) {
    const selected = resolveTask(loaded.config, spec({ backend: 'codex', task_class }));
    const command = invocation(loaded.config.backends.codex, selected, { text: '{}' }, { attempt_id: 'fixture' });
    assert.equal(command.args[command.args.indexOf('--model') + 1], selected.model);
    assert.ok(command.args.includes('model_reasoning_effort=' + JSON.stringify(selected.reasoning_effort)));
    assert.equal(command.stdin, '{}');
    assert.ok(command.args.includes('read-only'));
  }
});

test('scoped class/tier overrides replace a resolved pair without mutating the original task', (t) => {
  const { loaded } = fixture(t);
  const high = resolveTask(loaded.config, spec({ backend: 'codex', task_class: 'synthesis_planning' }));
  const low = resolveTask(loaded.config, high, { task_class: 'automation' });
  assert.equal(low.model_tier, 'low');
  assert.equal(low.model, 'gpt-6.1-sol');
  assert.equal(low.reasoning_effort, 'medium');
  assert.equal(high.model, 'gpt-6-astra');
  const medium = resolveTask(loaded.config, high, { model_tier: 'medium' });
  assert.equal(medium.reasoning_effort, 'high');
  assert.throws(() => resolveTask(loaded.config, spec({ backend: 'codex', model_tier: 'highest', model: 'conflicting-model' })), /Conflicting/);
});

test('explicit model/effort overrides have visible provenance and do not retain a misleading tier label', (t) => {
  const { loaded } = fixture(t);
  const routed = resolveTask(loaded.config, spec({ backend: 'codex', task_class: 'synthesis_planning' }));
  const explicit = resolveTask(loaded.config, routed, { model: 'gpt-6.1-sol', reasoning_effort: 'medium' });
  assert.equal(explicit.model_selection.source, 'explicit');
  assert.equal(explicit.model_tier, undefined);
  assert.equal(explicit.model, 'gpt-6.1-sol');
  assert.equal(explicit.reasoning_effort, 'medium');
});

test('unconfigured provider tiers cannot silently borrow the Codex tier model or effort', (t) => {
  const { loaded } = fixture(t);
  assert.equal(loaded.config.model_policy.backends.claude, null);
  assert.equal(loaded.config.model_policy.backends.antigravity.medium, undefined);
  for (const backend of ['claude', 'antigravity']) {
    assert.throws(() => resolveTask(loaded.config, spec({ backend, task_class: 'analysis' })), /not configured/);
  }
});

test('automation defaults across backends to Gemini Flash High without changing explicit or frozen selections', (t) => {
  const { loaded } = fixture(t, (c) => { c.backends.mock.model_family = 'codex'; });
  loaded.config.model_policy.task_class_backends = { automation: 'antigravity' };
  const selected = resolveTask(loaded.config, spec({ task_class:'automation' }));
  assert.equal(selected.backend, 'antigravity');
  assert.equal(selected.model, 'gemini-3.8-flash-high');
  assert.equal(selected.reasoning_effort, 'high');
  assert.equal(selected.model_tier, 'low');
  assert.equal(resolveTask(loaded.config, spec({ model_tier:'low' })).backend, 'antigravity');
  assert.equal(resolveTask(loaded.config, spec({ task_class:'analysis' })).backend, 'mock');
  assert.equal(resolveTask(loaded.config, spec({ backend:'codex', task_class:'automation' })).model, 'gpt-6.1-sol');
  assert.equal(resolveTask(loaded.config, spec({ task_class:'automation' }), {model:'explicit-worker'}).backend, 'mock');
  loaded.config.model_policy.task_class_backends.automation = 'codex';
  assert.equal(resolveTask(loaded.config, selected).backend, 'antigravity');
  assert.equal(resolveTask(loaded.config, selected).model, 'gemini-3.8-flash-high');
  loaded.config.model_policy.task_class_backends.automation = 'missing';
  assert.throws(()=>validateModelPolicy(loaded.config),/Unknown task class backend/);
  loaded.config.model_policy.task_class_backends = {analysis:'antigravity'};
  assert.throws(()=>validateModelPolicy(loaded.config),/not configured/);
});

test('Antigravity automation transmits High effort and large prompts through stdin without Codex flags', (t) => {
  const { loaded } = fixture(t);
  const selected = resolveTask(loaded.config, spec(), readJSON(path.join(ROOT,'examples/override-automation.json')));
  const prompt = 'Repeated automation input\n'.repeat(4000);
  const command = invocation(loaded.config.backends.antigravity, selected, {text:prompt,packet:{}}, {});
  assert.equal(command.args[command.args.indexOf('--model') + 1], 'gemini-3.8-flash-high');
  assert.equal(command.args[command.args.indexOf('--effort') + 1], 'high');
  assert.equal(command.args.includes('-c'), false);
  assert.equal(command.args.includes(prompt), false);
  assert.equal(command.args.join(' ').length < 1000, true);
  assert.equal(command.stdin.trim().split('\n').length, 1);
  assert.equal(JSON.parse(command.stdin).message.content, prompt);
  assert.throws(()=>invocation(loaded.config.backends.antigravity,{...selected,reasoning_effort:'max'}, {text:'x'}, {}),/Unsupported Antigravity/);
});

test('fallback keeps the requested tier and rebinds only through a configured target family', (t) => {
  const { loaded } = fixture(t);
  const high = resolveTask(loaded.config, spec({ backend: 'codex', task_class: 'synthesis_planning' }));
  loaded.config.backends.codex_second = { ...loaded.config.backends.codex, model_family: 'codex' };
  const next = modelForBackend(loaded.config, high, 'codex_second');
  assert.equal(next.model_tier, 'highest');
  assert.equal(next.model, 'gpt-6-astra');
  assert.equal(next.reasoning_effort, 'high');
  assert.throws(() => modelForBackend(loaded.config, high, 'claude'), /not configured/);
  loaded.config.model_policy.backends.codex.highest.model = 'another-config-version';
  assert.equal(modelForBackend(loaded.config, high, 'codex').model, 'gpt-6-astra');
});

test('attempt snapshots retain model/tier/effort without changing permission, budget or quota identity', (t) => {
  const { store } = fixture(t, (c) => { c.backends.mock.model_family = 'codex'; });
  task(store, { task_class: 'synthesis_planning' });
  const started = beginAttempt(store, 'review_scope', 'local', 1, 'routed-fixture');
  assert.equal(started.attempt.effective_config.model_tier, 'highest');
  assert.equal(started.attempt.effective_config.model, 'gpt-6-astra');
  assert.equal(started.attempt.effective_config.reasoning_effort, 'high');
  assert.equal(started.attempt.reservation_tokens, 500);
  assert.equal(started.context.packet.task.model_selection.task_class, 'synthesis_planning');
  assert.equal(store.read().config.execution.allow_external, false);
});

test('command adapters require explicit model/effort templates and never silently drop routed settings', (t) => {
  const { loaded } = fixture(t);
  loaded.config.backends.custom = { kind:'command', command:'not-executed', allow_execute:false, model_family:'codex',
    args:['--model','{{model}}','--effort','{{reasoning_effort}}'] };
  const selected = resolveTask(loaded.config, spec({ backend:'custom', task_class:'automation' }));
  const command = invocation(loaded.config.backends.custom, selected, { text:'{}', packet:{} }, {attempt_id:'fixture'});
  assert.deepEqual(command.args, ['--model','gpt-6.1-sol','--effort','medium']);
  loaded.config.backends.custom.args = ['--model','fixed'];
  assert.throws(() => resolveTask(loaded.config, spec({ backend:'custom', task_class:'automation' })), /template/);
});

test('legacy configs without a policy preserve explicit model selection', (t) => {
  const { loaded } = fixture(t);
  delete loaded.config.model_policy;
  const selected = resolveTask(loaded.config, spec({ backend:'codex', model:'legacy-model' }));
  assert.equal(selected.model, 'legacy-model');
  assert.equal(selected.reasoning_effort, null);
  assert.throws(() => resolveTask(loaded.config, spec({ backend:'codex', model_tier:'highest' })), /requires model_policy/);
});

test('CLI model preview is read-only and allows the three classes without running a model', async (t) => {
  const { configFile } = fixture(t);
  const selected = await main(['resolve-model','--config',configFile,'--backend','codex','--task-class','automation']);
  assert.equal(selected.executed, false);
  assert.equal(selected.model, 'gpt-6.1-sol');
  assert.equal(selected.reasoning_effort, 'medium');
  await assert.rejects(() => main(['resolve-model','--config',configFile,'--backend','codex','--task-class','unknown']), /Unknown task class/);
});

test('historical estimates keep Sol High and Sol Medium samples separate', (t) => {
  const { store } = fixture(t, (c) => { c.backends.mock.model_family = 'codex'; c.work_allocation = { min_history_samples: 1, quantile: .9, max_units_per_task: 32 }; });
  const units = [{ work_unit_id:'main', objective:'Synthetic estimation fixture', dependencies:[], expected_artifacts:[], estimate_key:'same-workload',
    estimate:{work_tokens:100,validation_tokens:0,checkpoint_tokens:0,margin_tokens:0,cost_usd:0,context_growth_tokens:0} }];
  task(store, { task_class:'analysis', work_units:units });
  const high=beginAttempt(store,'review_scope','local',1,'high-effort-history').attempt;
  finishAttempt(store,high.attempt_id,{status:'completed',result:resultFor(high,{usage:{input_tokens:2000,output_tokens:0,cached_input_tokens:0,cost_usd:0}})});
  task(store,{task_id:'low_effort',task_class:'automation',work_units:units});
  const low=beginAttempt(store,'low_effort','local',1,'low-effort-history').attempt;
  assert.equal(low.admission.estimate.samples,0);
  assert.equal(low.reservation_tokens,100);
});
