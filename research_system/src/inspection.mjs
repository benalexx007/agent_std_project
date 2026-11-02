// Read model shared by terminal and future GUI bindings. Never instantiate Store here.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config.mjs';
import { capabilities } from '../adapters/index.mjs';
import { readJSON, requireThat } from './util.mjs';

export const INSPECT_SECTIONS = ['project', 'config', 'models', 'roles', 'skills', 'capabilities', 'policy', 'runtime'];
const sensitive = (key) => /(?:apikey|password|passwd|secret|authorization|accesstoken|refreshtoken|idtoken|privatekey|credential|token)$/.test(key.replace(/[^a-z]/gi, '').toLowerCase());
const safeText = (s) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
export function redactInspection(value, key = '') {
  if (sensitive(key)) return '[REDACTED]';
  if (Array.isArray(value)) {
    let hideNext = false;
    return value.map((item) => {
      if (key === 'args' && typeof item === 'string') {
        if (hideNext) { hideNext = false; return '[REDACTED]'; }
        if (/^--/.test(item) && !item.includes('=') && sensitive(item)) { hideNext = true; return safeText(item); }
      }
      return redactInspection(item);
    });
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [safeText(k), /^(env|headers)$/i.test(key) ? '[REDACTED]' : redactInspection(v, k)]));
  if (typeof value !== 'string') return value;
  return safeText(value
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|token)\s*[=:]\s*)[^\s&"']+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@'));
}

function readState(workspace) {
  const file = path.join(workspace, '.agentic', 'state.sqlite');
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=1000');
    const row = db.prepare('SELECT payload FROM state WHERE id=1').get();
    requireThat(row, 'Empty state database');
    const state = JSON.parse(row.payload);
    requireThat(state && typeof state === 'object' && !Array.isArray(state), 'Malformed state snapshot');
    return state;
  } finally { db.close(); }
}
const entries = (v) => Object.entries(v || {});
const values = (v) => Object.values(v || {});
const page = (rows, full) => ({ total: rows.length, omitted: full ? 0 : Math.max(0, rows.length - 10), rows: full ? rows : rows.slice(0, 10) });

export function inspectProject(options = {}) {
  requireThat(!(options.config && options.workspace), 'Choose --config or --workspace, not both');
  requireThat(!options.section || INSPECT_SECTIONS.includes(options.section), 'Unknown inspect section');
  const errors = [], warnings = [];
  let candidate = null, raw = null, state = null;
  let workspace = options.workspace ? path.resolve(options.workspace) : options.config ? null : process.cwd();
  const configFile = options.config ? path.resolve(options.config) : null;
  if (configFile) {
    try {
      raw = readJSON(configFile);
      if (typeof raw?.project?.workspace === 'string') workspace = path.resolve(path.dirname(configFile), raw.project.workspace);
      candidate = loadConfig(configFile);
    } catch (error) { errors.push({ source: 'candidate_config', message: error.message }); }
  }
  if (workspace) {
    try { state = readState(workspace); }
    catch (error) { errors.push({ source: 'state', message: error.message }); }
  } else errors.push({ source: 'workspace', message: 'Cannot resolve workspace; use --workspace to inspect persisted state' });
  const supported = state && [1, 2, 3, 4, 5].includes(state.schema_version);
  if (state && !supported) errors.push({ source: 'state_version', message: 'Unsupported state version: ' + state.schema_version });
  const config = state?.config || candidate?.config || null;
  if (!config) errors.push({ source: 'config', message: 'No registered or valid candidate config available' });
  const drift = state && candidate ? state.config_hash !== candidate.config_hash : null;
  if (drift) warnings.push('Candidate config differs from registered state; no synchronization performed.');
  if (state && ![4, 5].includes(state.schema_version)) warnings.push('Legacy/unsupported schema: inspection only; no migration performed.');
  const tasks = supported ? entries(state.tasks) : [];
  const attempts = supported ? values(state.attempts).sort((a, b) => (b.timestamps?.created_at || '').localeCompare(a.timestamps?.created_at || '')) : [];
  const selected = (skill) => tasks.filter(([, t]) => t.spec?.skills?.includes(skill)).map(([id, t]) => ({ task_id: id, status: t.status }));
  const scopes = attempts.filter((a) => a.native?.extension_scope).map((a) => {
    const scope = a.native.extension_scope;
    return { attempt_id: a.attempt_id, backend: a.backend, thread_id: a.native.thread_id ?? null,
      observed_at: scope.checked_at, status: a.config_hash === state.config_hash && scope.binding_sha256 === a.extension_binding?.fingerprint ? 'historical_observation' : 'stale',
      scope: 'recorded worker connection; not current GUI', skills: scope.skills, hooks: scope.hooks, mcp_servers: scope.mcp_servers,
      verification: scope.verification, limitation: scope.limitation };
  });
  const sections = {
    project: { workspace, project: config?.project ?? null, initialized: Boolean(state), state_version: state?.schema_version ?? null,
      config_source: state?.config ? 'registered_snapshot' : candidate ? 'validated_candidate_not_active' : 'unavailable', owner: state?.owner ?? null,
      gui: state?.gui ? { revision: state.gui.revision, attachments: page(values(state.gui.attachments).map((a) => ({ attachment_id: a.attachment_id,
        host: a.host, surface: a.surface, identity_trust: a.identity_trust, detached_at: a.detached_at })), options.full) } : null },
    config: { registered_hash: state?.config_hash ?? null, candidate_file: configFile, candidate_hash: candidate?.config_hash ?? null,
      candidate_valid: configFile ? Boolean(candidate) : null, drift, provenance: state?.gui ? { revision: state.gui.revision, changes: page(values(state.gui.changes).map((c) => ({ change_id: c.change_id, base_revision: c.base_revision, applied_revision: c.applied_revision, status: c.status, at: c.at })), options.full) } : 'snapshot-level; granular field provenance is not recorded in v4',
      registered_or_candidate: config, ...(options.full && raw ? { candidate_input: raw } : {}),
      overlays: { active: state?.improvements?.active ?? null, changes: page(entries(state?.improvements?.changes).map(([id, c]) =>
        ({ change_id: id, config_hash: c.config_hash, files: c.files })), options.full) } },
    models: { configured_orchestrator: config?.orchestrator ?? null, policy: config?.model_policy ?? null,
      gui_model: { status: 'unknown', reason: 'Project selection does not change or verify GUI model' } },
    roles: config?.roles ?? {},
    skills: entries(config?.skills).map(([name, directory]) => ({ name, directory,
      allowed_roles: entries(config?.roles).filter(([, r]) => r.skills?.includes(name)).map(([id]) => id),
      selected_tasks: page(selected(name), options.full), native_loaded: 'unknown' })),
    capabilities: { backends: entries(config?.backends).map(([name, backend]) => {
      let declared;
      try { declared = capabilities(backend); } catch (error) { declared = { error: error.message }; }
      return { name, kind: backend.kind, command: backend.command ?? null, allow_execute: backend.allow_execute,
        native_pin: backend.native?.version ?? null, declared, live_verified: false };
    }), extensions: config?.extensions ?? { enabled: false }, gui_inventory: { status: 'unknown', reason: 'No live GUI connection queried' },
    native_worker_observations: page(scopes, options.full),
    gui_reported_observations: page(values(state?.gui?.observations).map((o) => ({ ...o,
      status: o.config_hash === state.config_hash ? 'recorded_attestation_not_live_verification' : 'stale_config' })), options.full) },
    policy: Object.fromEntries(['execution', 'autonomy', 'control', 'context', 'budget_reserves', 'quota_pools', 'recovery_policy', 'checkpoint_policy', 'workspace_policy', 'research_profile'].map((k) => [k, config?.[k] ?? null])),
    runtime: { desired_state: state?.desired_state ?? null, usage: state?.usage ?? null, pools: state?.pools ?? {},
      publication: state?.publication ?? null,
      gui_operations: page(values(state?.gui?.operations).map((op) => ({ operation_id: op.operation_id, task_id: op.task_id, state: op.state,
        owner_epoch: op.owner_epoch, created_at: op.created_at, ended_at: op.ended_at, result_ref: op.result_ref, error: op.error })), options.full),
      error_log: state?.gui ? '.agentic/logs/gui-errors.jsonl (bounded, redacted; inspect does not read log contents)' : null,
      pending_decisions: page(values(state?.decisions).filter((d) => d.status === 'pending'), options.full),
      tasks: page(tasks.map(([id, t]) => ({ task_id: id, status: t.status, desired_state: t.desired_state, revision: t.revision,
        backend: t.spec?.backend, role: t.spec?.role, model: t.spec?.model, effort: t.spec?.reasoning_effort, skills: t.spec?.skills })), options.full),
      attempts: page(attempts.map((a) => ({ attempt_id: a.attempt_id, task_id: a.task_id, revision: a.task_revision,
        observed_state: a.observed_state, desired_state: a.desired_state, settled: a.settled, config_hash: a.config_hash,
        effective_config: a.effective_config, native_effective: a.native?.effective ?? null,
        gui_provider: a.gui_provider ? { mode: a.gui_provider.mode, phase: a.gui_provider.phase, handle: a.gui_provider.handle ?? null,
          effective: a.gui_provider.effective, trust: a.gui_provider.trust, attachment_id: a.gui_provider.attachment_id } : null,
        reservation_tokens: a.reservation_tokens, job_refs: a.job_refs })), options.full) }
  };
  return redactInspection({ report_version: 1, snapshot_at: new Date().toISOString(), executed: false,
    coverage: 'local configuration and persisted observations only; no backend discovery',
    errors, warnings, sections: options.section ? { [options.section]: sections[options.section] } : sections });
}

export function renderInspection(report, { full = false, width = 100 } = {}) {
  width = Math.max(40, Math.min(160, width));
  const lines = ['PROJECT INSPECT', 'Snapshot: ' + report.snapshot_at, report.coverage];
  for (const error of report.errors) lines.push('ERROR [' + error.source + '] ' + error.message);
  for (const warning of report.warnings) lines.push('WARNING ' + warning);
  const sections = report.sections;
  for (const [name, data] of Object.entries(sections)) {
    lines.push('', name.toUpperCase());
    if (full) { lines.push(JSON.stringify(data, null, 2)); continue; }
    const show = (label, value) => lines.push('  ' + label.padEnd(22) + (typeof value === 'string' ? value : JSON.stringify(value)));
    if (name === 'project') {
      show('Workspace', data.workspace); show('Project / domain', [data.project?.id, data.project?.domain]);
      show('State / source', [data.state_version, data.config_source]);
    } else if (name === 'config') {
      show('Registered hash', data.registered_hash); show('Candidate file', data.candidate_file);
      show('Valid / drift', [data.candidate_valid, data.drift]); show('Provenance', data.provenance);
    } else if (name === 'models') {
      show('Orchestrator config', data.configured_orchestrator); show('GUI model', 'unknown');
      for (const [provider, tiers] of entries(data.policy?.backends)) {
        if (!tiers) show(provider, 'mapping not configured');
        else for (const [tier, binding] of entries(tiers)) show(provider + '/' + tier, binding.model + ' / ' + binding.reasoning_effort);
      }
    } else if (name === 'roles') {
      for (const [role, binding] of entries(data)) show(role, 'backend=' + binding.backend + '; allowed skills=' + (binding.skills || []).join(', '));
    } else if (name === 'skills') {
      for (const skill of data) show(skill.name, 'allowed: ' + skill.allowed_roles.join(', ') + '; selected tasks: ' + skill.selected_tasks.total + '; native loaded: unknown');
    } else if (name === 'capabilities') {
      for (const b of data.backends) show(b.name, b.kind + '; execute=' + b.allow_execute + '; live verified=false');
      show('Extensions', data.extensions.enabled ? 'configured enabled; see --section capabilities' : 'disabled');
      show('GUI inventory', 'unknown'); show('Worker receipts', data.native_worker_observations.total + ' historical; see --section capabilities');
    } else if (name === 'policy') {
      show('External execution', data.execution?.allow_external ?? null);
      show('Concurrency / tokens', [data.execution?.max_concurrent, data.execution?.max_tokens]);
      show('Workspace policy', data.workspace_policy); show('Fallback', data.recovery_policy);
      show('Decision required', data.autonomy?.require_decision_for ?? []);
    } else if (name === 'runtime') {
      show('Project desired state', data.desired_state); show('Usage', data.usage);
      show('Pending decisions', data.pending_decisions.total); show('Publication pending', Boolean(data.publication));
      for (const t of data.tasks.rows) show(t.task_id, [t.status, t.role, t.backend]);
      show('Tasks / omitted', [data.tasks.total, data.tasks.omitted]); show('Attempts / omitted', [data.attempts.total, data.attempts.omitted]);
    }
  }
  lines.push('', 'Details: --section config|skills|capabilities|policy|runtime | --full | --format json');
  return lines.flatMap((line) => line.split('\n').flatMap((part) => {
    const result = [];
    // Code points, not UTF-16 halves; plain text remains safe when redirected.
    const chars = Array.from(safeText(part));
    do { result.push(chars.splice(0, width).join('')); } while (chars.length);
    return result;
  })).join('\n');
}
