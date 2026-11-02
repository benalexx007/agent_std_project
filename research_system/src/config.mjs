import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, requireThat, hash, confined, clone } from './util.mjs';
import { contract } from './schema.mjs';
import { capabilities } from '../adapters/index.mjs';
import { resourceDefaults } from './resources.mjs';
import { unitSpecs } from './work.mjs';
import { applyModelOverride, selectModel, taskBackend, validateModelPolicy } from './models.mjs';

import { extensionDocuments, resolveExtensions } from './extensions.mjs';
import { activeDomain } from './domains.mjs';

export function loadConfig(file) {
  const absolute = path.resolve(file);
  return normalizeConfig(readJSON(absolute), absolute);
}

export function normalizeConfig(input, sourceFile) {
  const absolute = path.resolve(sourceFile);
  const domain = activeDomain(input?.project?.domain);
  const raw = contract(domain.config_schema, clone(input));
  const config = resourceDefaults(clone(raw));
  config.project.workspace = path.resolve(path.dirname(absolute), raw.project.workspace);
  config.bundle_root = path.resolve(path.dirname(absolute), raw.bundle_root || ROOT);
  requireThat(fs.existsSync(config.bundle_root), 'Bundle root does not exist');
  domain.validateConfig(config);
  requireThat(Object.hasOwn(config.backends, config.orchestrator.backend), 'Unknown orchestrator backend');
  for (const required of domain.required_roles) requireThat(Object.hasOwn(config.roles, required), 'Missing research responsibility: ' + required);
  for (const [name, role] of Object.entries(config.roles)) {
    requireThat(Object.hasOwn(config.backends, role.backend), 'Unknown role backend: ' + name);
    confined(config.bundle_root, role.profile);
    for (const skill of role.skills) requireThat(Object.hasOwn(config.skills, skill), 'Unknown skill: ' + skill);
  }
  for (const [skill, directory] of Object.entries(config.skills)) {
    const text = fs.readFileSync(confined(config.bundle_root, path.join(directory, 'SKILL.md')), 'utf8');
    requireThat(text.startsWith('---\n') || text.startsWith('---\r\n'), 'Missing skill metadata: ' + skill);
    requireThat(new RegExp('^name: ' + skill + '\\r?$', 'm').test(text), 'Skill name mismatch: ' + skill);
  }
  for (const backend of Object.values(config.backends)) {
    capabilities(backend);
    if (backend.kind !== 'mock' && backend.kind !== 'manual') requireThat(backend.command, 'External backend needs command');
    if (backend.kind === 'codex-app-server') requireThat(backend.native?.version && backend.native.delegation_mode === 'harness_workers', 'Native Codex requires a pinned version and harness_workers delegation');
    for (const poolId of backend.quota_pool_ids || []) requireThat(Object.hasOwn(config.quota_pools, poolId), 'Undefined quota pool');
  }
  for (const name of config.recovery_policy.candidates) requireThat(Object.hasOwn(config.backends, name), 'Undefined fallback backend: ' + name);
  const extensions = extensionDocuments(config);
  if (extensions) config.extension_fingerprint = extensions.fingerprint;
  validateModelPolicy(config);
  return { config, config_hash: hash(JSON.stringify(config)), config_file: absolute };
}

export function resolveTask(config, input, override = {}) {
  const domain = activeDomain(config.project.domain);
  const allowed = new Set(['role', 'backend', 'model', 'reasoning_effort', 'task_class', 'model_tier', 'skills', 'budget', 'extension_profile', 'extension_scope', ...domain.task_override_keys]);
  for (const key of Object.keys(override)) requireThat(allowed.has(key), 'Unsupported task override: ' + key);
  requireThat(input?.domain === domain.id, 'Task domain differs from project');
  const task = contract(domain.task_schema, applyModelOverride(input, override));
  const role = Object.hasOwn(config.roles, task.role) ? config.roles[task.role] : null;
  requireThat(role, 'Undefined role: ' + task.role);
  task.backend = taskBackend(config, task, role.backend);
  Object.assign(task, selectModel(config, task));
  task.skills = task.skills || role.skills.slice(0, 1);
  domain.validateTask(config, task);
  requireThat((task.analysis_input_paths || []).every((p) => task.inputs.some((r) => r.path === p)), 'Declared analysis inputs must be task inputs');
  requireThat(task.purpose !== 'benchmark' || task.benchmark_request_id, 'Benchmark task needs a per-run request');
  requireThat(!task.benchmark_request_id || task.purpose === 'benchmark', 'Benchmark request requires explicit benchmark purpose');
  requireThat(Object.hasOwn(config.backends, task.backend), 'Unknown task backend');
  for (const skill of task.skills) {
    requireThat(Object.hasOwn(config.skills, skill), 'Unknown skill');
    requireThat(role.skills.includes(skill), 'Skill is not bound to role: ' + skill);
  }
  const caps = capabilities(config.backends[task.backend]);
  if (config.workspace_policy?.mode === 'snapshot_directory') {
    const canonical = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
    const immutable = new Set(task.inputs.map((r) => canonical(r.path)));
    const outputs = [...task.expected_artifacts, ...unitSpecs(task).flatMap((u) => u.expected_artifacts)];
    requireThat(outputs.every((p) => !immutable.has(canonical(p))), 'Isolated outputs cannot overwrite declared immutable inputs; use workspace_policy.include for editable sources');
    const spelling = new Map();
    for (const p of outputs) {
      requireThat(!spelling.has(canonical(p)) || spelling.get(canonical(p)) === p, 'Output paths alias on this filesystem');
      spelling.set(canonical(p), p);
    }
  }
  const selectedBackend = config.backends[task.backend];
  if (selectedBackend.kind === 'codex-app-server') requireThat(task.writes_workspace === (selectedBackend.sandbox === 'workspace-write'), 'Native writable permission must match writes_workspace for writer admission');
  for (const capability of task.capabilities) requireThat(caps[capability] === true, 'Unsupported capability: ' + capability);
  requireThat(task.study_type === config.project.study_type, 'Task study_type differs from project');
  const seen = new Set();
  requireThat(unitSpecs(task).length <= config.work_allocation.max_units_per_task, 'Work unit count exceeds policy');
  for (const unit of unitSpecs(task)) {
    requireThat(!seen.has(unit.work_unit_id) && unit.dependencies.every((d) => seen.has(d)), 'Duplicate or unordered work unit dependency');
    seen.add(unit.work_unit_id);
  }
  resolveExtensions(config, task);
  return task;
}
