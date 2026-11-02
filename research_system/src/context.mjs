import fs from 'node:fs';
import path from 'node:path';
import { confined, hash, requireThat, fileHash } from './util.mjs';
import { bundleResource } from './improvements.mjs';
import { orchestratorModel } from './models.mjs';
import { isPlanning } from './planning.mjs';
import { readBundleText } from './bundle-cache.mjs';

import { resolveExtensions } from './extensions.mjs';
import { activeDomain, projectDomain } from './domains.mjs';

export function buildContext(config, task, decisions = [], updates = [], state = null) {
  const domain = activeDomain(config.project.domain);
  requireThat(task.domain === domain.id, 'Task domain differs from project');
  if (state) projectDomain(state);
  const role = config.roles[task.role];
  const bundleRefs = new Map();
  const readBundle = (ref) => {
    const resource = bundleResource(config, state, ref);
    const content = readBundleText(resource);
    bundleRefs.set(ref, resource.ref);
    return content;
  };
  const { profile, guidance } = domain.guidance(config, task, readBundle, isPlanning(task));
  const extensions = resolveExtensions(config, task);
  const skills = task.skills.map((name) => ({ name, instructions: readBundle(path.join(config.skills[name], 'SKILL.md')) }));
  const inputs = task.inputs.map((ref) => {
    const file = confined(config.project.workspace, ref.path);
    const actual = fileHash(file);
    requireThat(!ref.sha256 || ref.sha256 === actual, 'Input changed: ' + ref.path);
    const record = { ...ref, sha256: actual };
    if (ref.include === true) record.content = fs.readFileSync(file, 'utf8');
    return record;
  });
  const resultSchema = JSON.parse(readBundle('schemas/result.schema.json'));
  if (!isPlanning(task)) delete resultSchema.properties.planning_review;
  if (task.writes_workspace) resultSchema.properties.artifacts.items.required = ['path'];
  const packet = {
    ...(extensions ? { extensions } : {}),
    objective: config.project.objective,
    position: 'worker',
    workspace: config.project.workspace,
    role: task.role,
    role_instructions: readBundle(role.profile),
    task,
    task_output_requirements: state?.tasks[task.task_id]?.spec.expected_artifacts || task.expected_artifacts,
    ...(isPlanning(task) ? { planning_requirements: domain.planning_requirements } : {}),
    ...domain.workerFields(config, task, state, profile, guidance),
    skill_catalog: Object.keys(config.skills),
    active_skills: skills,
    study_guidance: readBundle(domain.rubric(task)),
    inputs,
    user_updates: updates,
    decisions: decisions.filter((d) => d.status === 'answered' && d.affected_tasks.includes(task.task_id) && d.task_revisions[task.task_id] === task.task_revision),
    output_contract: 'Return only a JSON object matching the result contract supplied below. Only declared writable output artifacts may omit sha256 for harness pinning at publication. Input/evidence/planning refs require their observed hashes. Transport completion is not a scientific verdict.',
    result_schema: resultSchema
  };
  packet.bundle_refs = [...bundleRefs.values()];
  if (task.role === 'orchestrator' && state) {
    packet.position = 'orchestrator';
    packet.orchestration = buildOrchestratorContext(state, task.model_selection?.task_class).packet;
    packet.worker_task_contract = JSON.parse(readBundle('schemas/task.schema.json'));
    packet.bundle_refs = [...bundleRefs.values()];
  }
  const text = JSON.stringify(packet, null, 2);
  requireThat(text.length <= config.context.max_chars, 'Context exceeds max_chars; narrow inputs or skill selection (no silent truncation)');
  return { packet, text, sha256: hash(text), characters: text.length, tokenizer_tokens: null };
}
export function buildOrchestratorContext(state, taskClass, options = {}) {
  const domain = projectDomain(state);
  const config = state.config;
  const selected = orchestratorModel(config, taskClass);
  const ids = options.taskIds || Object.keys(state.tasks).filter((tid) => !['completed', 'cancelled'].includes(state.tasks[tid].status));
  requireThat(Array.isArray(ids) && ids.every((tid) => Object.hasOwn(state.tasks, tid)), 'Unknown orchestrator task selection');
  const scope = new Set(ids);
  for (const tid of scope) for (const dep of state.tasks[tid].spec.dependencies) scope.add(dep);
  const visible = (tid) => scope.has(tid);
  const packet = {
    position: 'orchestrator',
    backend: config.orchestrator.backend,
    model: selected.model,
    reasoning_effort: selected.reasoning_effort,
    model_selection: selected.model_selection,
    model_policy: config.model_policy || null,
    ...(selected.model_selection.task_class === 'synthesis_planning' ? { planning_requirements: domain.planning_requirements } : {}),
    objective: config.project.objective,
    owner: state.owner,
    desired_state: state.desired_state,
    selection: { task_ids: [...scope], omitted_tasks: Object.keys(state.tasks).filter((tid) => !visible(tid)),
      mode: options.taskIds ? 'explicit_scope_with_dependencies' : 'active_frontier_with_dependencies',
      lookup: 'harness_status(task_ids) or prepare-orchestrator --tasks; no silent truncation' },
    instructions: fs.readFileSync(bundleResource(config, state, domain.orchestrator_profile).file, 'utf8'),
    config_hash: state.config_hash,
    roles: config.roles,
    extension_policy: config.extensions ? { enabled: config.extensions.enabled,
      profiles: Object.fromEntries(Object.entries(config.extensions.profiles).map(([name, p]) => [name, {
        roles: p.roles, backends: p.backends, operations: p.operations, network: p.network }])),
      selection: 'Set worker extension_profile explicitly; coordinator has no helper execution permission.' } : null,
    ...domain.orchestratorFields(config),
    [domain.index_key]: Object.values(domain.state(state).records).filter((history) => visible(history.at(-1).record.task_id)).map((history) => {
      const e = history.at(-1); return { record_id: e.record.record_id, revision: e.record.revision, task_id: e.record.task_id, kind: e.record.kind, sha256: e.sha256 };
    }),
    improvement_index: state.improvements ? { active: state.improvements.active, changes: Object.keys(state.improvements.changes) } : null,
    benchmark_requests: Object.values(state.benchmarks?.requests || {}).map((r) => ({ request_id: r.request_id, status: r.status, protocol: r.protocol,
      execution_manifest: r.execution_manifest || null, superseded_by: r.superseded_by || null })),
    skill_catalog: Object.keys(config.skills),
    tasks: Object.fromEntries(Object.entries(state.tasks).filter(([key]) => visible(key)).map(([key, t]) => [key, {
      objective: t.spec.objective, role: t.spec.role, model_selection: t.spec.model_selection || null, revision: t.revision, status: t.status,
      desired_state: t.desired_state, dependencies: t.spec.dependencies, attempts: t.attempts,
      result: t.result ? { summary: t.result.summary, validity: t.result.validity, artifacts: t.result.artifacts,
        evidence_refs: t.result.evidence_refs, limitations: t.result.limitations, unresolved: t.result.unresolved } : null
    }])),
    active_jobs: Object.values(state.attempts).filter((a) => !a.settled).map((a) => ({
      attempt_id: a.attempt_id, task_id: a.task_id, observed_state: a.observed_state, desired_state: a.desired_state, jobs: a.job_refs
    })),
    work_units: Object.values(state.work_units || {}).filter((u) => visible(u.task_id)).map((u) => ({
      task_id: u.task_id, work_unit_id: u.spec.work_unit_id, status: u.status, generation: u.generation, checkpoint_id: u.checkpoint_id
    })),
    resource_pools: state.pools,
    budget_reserves: config.budget_reserves,
    recovery_policy: config.recovery_policy,
    pending_decisions: Object.values(state.decisions).filter((d) => d.status === 'pending'),
    authorizations: config.autonomy.grants,
    previous_decisions: Object.values(state.decisions).filter((d) => d.status === 'answered' && d.affected_tasks.some(visible)),
    pending_controls: Object.values(state.events).filter((e) => e.status !== 'verified'),
    usage: state.usage,
    record_location: '.agentic/state.sqlite',
    cli_help: 'node scripts/harness.mjs --help',
    limits: ['Use create-handoff for the full durable record; this is a bounded orchestration context.']
  };
  const text = JSON.stringify(packet, null, 2);
  requireThat(text.length <= config.context.max_chars, 'Orchestrator context exceeds max_chars; review selected records instead of silent truncation');
  return { packet, text, sha256: hash(text), characters: text.length };
}
