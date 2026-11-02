import { clone, requireThat } from './util.mjs';
import { contract } from './schema.mjs';

export const TASK_CLASSES = ['synthesis_planning', 'analysis', 'automation'];
export const MODEL_TIERS = ['highest', 'medium', 'low'];
export function modelFamily(backend) {
  return backend.model_family || ({ 'codex-cli': 'codex', 'codex-app-server': 'codex', 'claude-cli': 'claude', 'agy-cli': 'antigravity' }[backend.kind] ?? null);
}

export function validateModelPolicy(config) {
  if (config.model_policy) contract('model-policy', config.model_policy);
  for (const [task_class, backend] of Object.entries(config.model_policy?.task_class_backends || {})) {
    requireThat(Object.hasOwn(config.backends, backend), 'Unknown task class backend: ' + backend);
    selectModel(config, { backend, task_class });
  }
  // No remote model discovery or speculative equivalence between providers.
  if (config.orchestrator.task_class || config.orchestrator.model_tier || config.orchestrator.reasoning_effort) {
    selectModel(config, config.orchestrator, config.model_policy?.orchestrator_task_class);
  }
}

function checkEffortMapping(backend, effort, tierSelected) {
  if (effort == null || ['mock', 'manual'].includes(backend.kind)) return;
  if (['codex-cli', 'codex-app-server'].includes(backend.kind)) return;
  if (backend.kind === 'agy-cli') {
    requireThat(['low', 'medium', 'high'].includes(effort), 'Unsupported Antigravity reasoning effort');
    return;
  }
  if (backend.kind === 'command') {
    requireThat((backend.args || []).some((a) => a.includes('{{reasoning_effort}}')), 'Command adapter needs a {{reasoning_effort}} template for routed effort');
    if (tierSelected) requireThat((backend.args || []).some((a) => a.includes('{{model}}')), 'Command adapter needs a {{model}} template for routed model');
    return;
  }
  throw new Error('Reasoning effort mapping is not configured for backend kind: ' + backend.kind);
}

export function taskBackend(config, request, roleBackend) {
  // Do not reroute an explicit backend/model or a frozen task during revalidation/recovery.
  if (request.backend) return request.backend;
  if (request.model != null || request.reasoning_effort != null) return roleBackend;
  const policy = config.model_policy;
  const classes = request.model_tier && policy ? TASK_CLASSES.filter((name) => policy.task_class_tiers[name] === request.model_tier) : [];
  const taskClass = request.task_class || (classes.length === 1 ? classes[0] : policy?.default_task_class);
  return policy?.task_class_backends?.[taskClass] || roleBackend;
}

/** Resolve a new task. A model_selection snapshot tells re-validation which values were derived. */
export function selectModel(config, request, defaultClass) {
  const backend = config.backends[request.backend]; requireThat(Object.hasOwn(config.backends, request.backend), 'Unknown model backend');
  const policy = config.model_policy, family = modelFamily(backend);
  requireThat(!request.model_tier || MODEL_TIERS.includes(request.model_tier), 'Unknown model tier');
  requireThat(!request.task_class || TASK_CLASSES.includes(request.task_class), 'Unknown task class');
  const tierClasses = request.model_tier && policy ? TASK_CLASSES.filter((name) => policy.task_class_tiers[name] === request.model_tier) : [];
  if (request.model_tier && !request.task_class && policy) requireThat(tierClasses.length === 1, 'Model tier needs an unambiguous task class; specify task_class');
  const taskClass = request.task_class || tierClasses[0] || defaultClass || policy?.default_task_class || null;
  const priorSource = request.model_selection?.source;
  const explicit = priorSource === 'explicit' || (!request.model_tier && !request.task_class && priorSource !== 'tier' &&
    (request.model != null || request.reasoning_effort != null));
  const requestsTier = Boolean(request.model_tier || request.task_class || priorSource === 'tier');
  let model, effort, selectedTier = null, source;
  if (explicit) {
    model = request.model ?? backend.model ?? null;
    effort = request.reasoning_effort ?? (request.model == null ? backend.reasoning_effort : null) ?? null;
    source = 'explicit';
  } else if (requestsTier || (policy && family && policy.backends[family] != null)) {
    requireThat(policy, 'Task class/model tier requires model_policy');
    requireThat(TASK_CLASSES.includes(taskClass), 'Unknown task class');
    selectedTier = request.model_tier || policy.task_class_tiers[taskClass];
    const binding = family && policy.backends[family]?.[selectedTier];
    requireThat(binding, 'Model tier is not configured for backend family: ' + (family || backend.kind));
    model = binding.model; effort = binding.reasoning_effort; source = 'tier';
    if (!priorSource) {
      requireThat(request.model == null || request.model === model, 'Conflicting model and model tier; use one selection mechanism');
      requireThat(request.reasoning_effort == null || request.reasoning_effort === effort, 'Conflicting reasoning effort and model tier');
    }
  } else {
    // Legacy configs and unconfigured non-model/manual adapters keep their previous behavior.
    model = request.model ?? backend.model ?? null; effort = request.reasoning_effort ?? backend.reasoning_effort ?? null;
    source = policy && family && policy.backends[family] == null ? 'unconfigured' : 'backend_default';
    requireThat(source !== 'unconfigured' || ['mock', 'manual'].includes(backend.kind) || model != null,
      'Model policy is not configured for backend family: ' + family);
  }
  checkEffortMapping(backend, effort, source === 'tier');
  return { model, reasoning_effort: effort, ...(selectedTier ? { model_tier: selectedTier } : {}),
    model_selection: { source, model_family: family, task_class: taskClass, model_tier: selectedTier, model, reasoning_effort: effort } };
}

export function applyModelOverride(input, override) {
  const task = { ...clone(input), ...clone(override) };
  const has = (key) => Object.hasOwn(override, key);
  if (['model', 'reasoning_effort', 'model_tier', 'task_class', 'backend'].some(has)) {
    const wasTier = input.model_selection?.source === 'tier';
    delete task.model_selection;
    if (has('backend') && override.backend !== input.backend) {
      if (!has('model')) delete task.model;
      if (!has('reasoning_effort')) delete task.reasoning_effort;
    }
    if (has('task_class') && !has('model_tier')) delete task.model_tier;
    if (has('model_tier') || has('task_class') || (has('backend') && wasTier)) {
      if (!has('model')) delete task.model;
      if (!has('reasoning_effort')) delete task.reasoning_effort;
    } else if (has('model') || has('reasoning_effort')) {
      delete task.model_tier;
      task.model_selection = { source: 'explicit', model_family: null, task_class: task.task_class || null, model_tier: null,
        model: task.model ?? null, reasoning_effort: task.reasoning_effort ?? null };
      if (has('model') && !has('reasoning_effort')) delete task.reasoning_effort;
    }
  }
  return task;
}

/** Existing same-backend tasks retain their frozen selection. A fallback rebinds the same tier, never downgrades silently. */
export function modelForBackend(config, task, backendName) {
  if (backendName === task.backend) return clone(task);
  const next = { ...clone(task), backend: backendName };
  delete next.model; delete next.reasoning_effort;
  if (task.model_selection?.source === 'tier') {
    Object.assign(next, selectModel(config, { ...next, model_selection: undefined }, task.model_selection.task_class));
  } else {
    delete next.model_selection; delete next.model_tier; delete next.task_class;
    const backend = config.backends[backendName]; requireThat(Object.hasOwn(config.backends, backendName), 'Unknown fallback backend');
    const model = backend.model ?? null, reasoning_effort = backend.reasoning_effort ?? null;
    checkEffortMapping(backend, reasoning_effort, false);
    Object.assign(next, { model, reasoning_effort, model_selection: { source: 'backend_default', model_family: modelFamily(backend),
      task_class: task.model_selection?.task_class || task.task_class || null, model_tier: null, model, reasoning_effort } });
  }
  return next;
}

export function orchestratorModel(config, taskClass) {
  const request = { ...config.orchestrator };
  const className = taskClass || request.task_class || config.model_policy?.orchestrator_task_class;
  if (taskClass) { delete request.model_tier; delete request.model; delete request.reasoning_effort; }
  if (className && config.model_policy && modelFamily(config.backends[request.backend]) &&
    (taskClass || request.task_class || (!request.model_tier && request.model == null))) {
    request.task_class = className;
    // Null means inherit the policy. An explicit configured model is preserved only without tier/class selection.
  }
  return selectModel(config, request, className);
}
