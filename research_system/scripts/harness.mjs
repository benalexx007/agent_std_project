#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig, resolveTask } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { buildContext, buildOrchestratorContext } from '../src/context.mjs';
import { runTask } from '../src/runner.mjs';
import { registerTask, reviseTask, control, requestDecision, answerDecision, takeOwnership,
  handoff, reconcile, recordRun, recordClaim, finishAttempt, reopenTask, validateResult, checkOwner, adoptResult, registerJob, observeJob, ACTIVE } from '../src/engine.mjs';
import { getUnit } from '../src/work.mjs';
import { initialPools, budgetAdmission, updatePool, recordTelemetry } from '../src/resources.mjs';
import { saveCheckpoint, saveFinalCheckpoint, loadCheckpoint } from '../src/checkpoints.mjs';
import { planRecovery } from '../src/recovery.mjs';
import { capabilities } from '../adapters/index.mjs';
import { collectResults, checkEvidence, verifyArtifacts } from '../src/artifacts.mjs';
import { usageReport } from '../src/report.mjs';
import { recordResearch, researchEntry, researchValidity, researchReview, renderResearch } from '../src/research.mjs';
import { projectDomain, availableDomains } from '../src/domains.mjs';
import { proposeImprovement, activateImprovement } from '../src/improvements.mjs';
import { requestBenchmark, confirmBenchmark, supersedeBenchmark } from '../src/benchmarks.mjs';
import { selectModel } from '../src/models.mjs';
import { probeCodex, inspectCodex, collectCodex, readCodexQuota } from '../src/codex-native.mjs';
import { completeAttempt, recoverPublication } from '../src/publication.mjs';
import { normalizeCodexQuota, verifyResultTermination } from '../src/native-recovery.mjs';
import { publicationPending } from '../src/workspaces.mjs';
import { answerNativeInput } from '../src/native-state.mjs';
import { ROOT, id, now, readJSON, writeJSON, writeText, requireThat, clone, hash, confined } from '../src/util.mjs';

import { extensionDocuments } from '../src/extensions.mjs';
import { runExtension, reconcileExtensionCall } from '../src/extension-runner.mjs';
import { inspectProject, renderInspection, INSPECT_SECTIONS } from '../src/inspection.mjs';
import { GuiService, GUI_ACTIONS, GUI_REQUEST_SCHEMA, GUI_DATA_FIELDS } from '../src/gui-service.mjs';
import { connectGui, disconnectGui } from '../src/gui-connect.mjs';
import { upgradeGui } from '../src/gui-state.mjs';
import { confirmGuiChange } from '../src/gui-changes.mjs';

export const HELP = [
  'Agentic Research Harness (Node >=24; local state; no dependencies)',
  'node scripts/harness.mjs <command> --config examples/research.json [options]',
  'Emergency status/control: use --workspace PATH instead of --config if config is broken.',
  '',
  'validate-config | capabilities | init | sync-config | status',
  'inspect-project [--workspace PATH | --config FILE] [--full] [--section NAME] [--format json|text]',
  'upgrade-gui --workspace PATH (explicit v4 to v5 migration; backup, idle only)',
  'connect-gui | disconnect-gui --workspace PATH --backend codex|claude|antigravity (project files only)',
  'gui-catalog (action discovery; no project, model or network)',
  'gui-attach --workspace PATH --file host.json [--out binding.json]',
  'gui-action --workspace PATH --auth binding.json --file request.json',
  'confirm-gui-change --workspace PATH --file human-confirmation.json (human CLI only)',
  'migrate-state --workspace PATH',
  'validate-extensions | extension-calls [--attempt ID]',
  'extension-call --attempt ID --key KEY --file call.json --owner ID --epoch N --execute',
  'reconcile-extension --request CALL_ID --owner ID --epoch N (after terminal job observation)',
  'register-task --file task.json [--override overrides.json]',
  'revise-task --file task.json --owner ID --epoch N',
  'reopen-task --task ID --file review.json --owner ID --epoch N',
  'prepare-task --task ID [--out context.json]',
  'prepare-orchestrator [--task-class synthesis_planning|analysis|automation] [--out orchestrator.json]',
  'run-orchestrator --task ID --owner ID --epoch N --key KEY [--execute] (register role=orchestrator first)',
  'probe-backend --backend NAME (version/protocol metadata only; no inference)',
  'native-requests --attempt ID | answer-native-input --attempt ID --request ID --file answers.json',
  'recover-publication --owner ID --epoch N [--action complete|rollback] (no model invocation)',
  'collect-native --attempt ID [--execute] [--out candidate.json] (history only; no adoption or inference)',
  'refresh-native-quota --backend NAME --pool ID --limit ID [--execute] (percent metadata; never token conversion)',
  'inspect-native --attempt ID [--execute] (thread metadata only; never releases reservation)',
  'resolve-model --backend NAME [--task-class CLASS] [--model-tier highest|medium|low]',
  'run-task --task ID --owner ID --epoch N --key KEY --execute',
  'control-task --action status|steer|pause|cancel|resume --target ID|project',
  '             [--message TEXT] [--event ID] [--revision N]',
  'request-decision --file decision.json | answer-decision --decision ID --answer approve|decline',
  'claim-owner --owner NEW --epoch CURRENT',
  'adopt-result --attempt ID --owner ID --epoch N',
  'import-result --attempt ID --file result.json [--observation stopped.json --owner ID --epoch N]',
  'reconcile-state [--file observations.json]',
  'record-run --file run.json | record-claim --file claim.json',
  'collect-results | report-usage | check-evidence | verify-artifacts --file artifact-list.json',
  'create-handoff [--out handoff.json]',
  'plan-work --task ID | allocate-budget --task ID [--unit ID]',
  'save-checkpoint --attempt ID --file progress.json',
  'prepare-recovery --task ID --owner ID --epoch N',
  'recover-task --task ID --owner ID --epoch N --key KEY [--execute]',
  'update-quota --pool ID --file snapshot.json',
  'record-telemetry --attempt ID --file telemetry.json',
  'register-job --attempt ID --file job.json',
  'observe-job --attempt ID --job ID --file observation.json',
  'record-research --file record.json --owner ID --epoch N [--attempt ID]',
  'read-research --record ID [--revision N] | review-research [--task ID]',
  'export-research --task ID [--format json|markdown] [--out FILE]',
  'record-domain/read-domain/review-domain/export-domain: domain-neutral aliases for the matching record commands',
  'hash-artifact --file WORKSPACE_RELATIVE_PATH',
  'propose-improvement --file change.json --owner ID --epoch N',
  'activate-improvement --change ID|original --owner ID --epoch N | list-improvements',
  'request-benchmark --file request.json --owner ID --epoch N',
  'confirm-benchmark --request ID --file human-confirmation.json --owner ID --epoch N',
  'supersede-benchmark --request ID --file replacement.json --owner ID --epoch N',
  'Every benchmark run requires its own human confirmation with the linked protocol; no implicit approval.',
  '',
  'run-task without --execute only prepares context. No command launches an external model by default.',
  'Control commands run in a second terminal while run-task is active. Pause boundary: current work unit end.'
].join('\n');

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    observation: { type: 'string' }, limit: { type: 'string' }, config: { type: 'string' }, workspace: { type: 'string' }, file: { type: 'string' }, task: { type: 'string' }, override: { type: 'string' },
    owner: { type: 'string' }, epoch: { type: 'string' }, key: { type: 'string' }, execute: { type: 'boolean', default: false },
    out: { type: 'string' }, action: { type: 'string' }, target: { type: 'string' }, message: { type: 'string' },
    event: { type: 'string' }, revision: { type: 'string' }, decision: { type: 'string' }, answer: { type: 'string' },
    attempt: { type: 'string' }, unit: { type: 'string' }, pool: { type: 'string' }, job: { type: 'string' }, help: { type: 'boolean', default: false },
    record: { type: 'string' }, change: { type: 'string' }, request: { type: 'string' }, format: { type: 'string' },
    full: { type: 'boolean', default: false }, section: { type: 'string' },
    auth: { type: 'string' },
    backend: { type: 'string' }, 'task-class': { type: 'string' }, 'model-tier': { type: 'string' }, tasks: { type: 'string' }
  } });
  const command = parsed.positionals[0];
  const o = parsed.values;
  if (!command || o.help) return HELP;
  if (command === 'gui-catalog') return { request_schema: GUI_REQUEST_SCHEMA, actions: GUI_ACTIONS, data_fields: GUI_DATA_FIELDS,
    domains: availableDomains(),
    transport: 'project-bound CLI; no extra runtime or MCP required', human_only: ['confirm-gui-change', 'answer-decision', 'confirm-benchmark'],
    documentation: path.join(ROOT, 'docs/gui-integration.md') };
  if (['connect-gui', 'disconnect-gui'].includes(command)) {
    requireThat(o.workspace && !o.config && o.backend, 'Connection requires --workspace and --backend');
    return command === 'connect-gui' ? connectGui(o.workspace, o.backend) : disconnectGui(o.workspace, o.backend);
  }
  if (['upgrade-gui', 'gui-attach', 'gui-action', 'confirm-gui-change'].includes(command)) {
    requireThat(o.workspace && !o.config, 'GUI commands require one fixed --workspace');
    const guiStore = new Store(path.resolve(o.workspace));
    try {
      if (command === 'upgrade-gui') return upgradeGui(guiStore);
      if (command === 'confirm-gui-change') return confirmGuiChange(guiStore, readJSON(o.file));
      const service = new GuiService(guiStore);
      if (command === 'gui-attach') {
        const binding = service.attach(readJSON(o.file));
        const file = o.out ? path.resolve(o.out) : path.join(guiStore.directory, 'gui-bindings', binding.attachment_id + '.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(binding, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        return { attached: true, attachment_id: binding.attachment_id, auth_file: file, identity_trust: binding.identity_trust };
      }
      return await service.call(readJSON(o.auth), readJSON(o.file));
    } finally { guiStore.close(); }
  }
  if (command === 'inspect-project') {
    if (o.execute || o.config && o.workspace || o.format && !['text', 'json'].includes(o.format) ||
        o.section && !INSPECT_SECTIONS.includes(o.section)) {
      const error = new Error('Invalid inspect options: use one source, a valid section and text|json; --execute is not supported');
      error.code = 'INSPECT_USAGE'; throw error;
    }
    const report = inspectProject(o);
    if (report.errors.length) process.exitCode = 1;
    return o.format === 'json' ? report : renderInspection(report, { full: o.full || Boolean(o.section), width: process.stdout.columns || 100 });
  }
  const emergencyCommands = ['status', 'control-task', 'reconcile-state', 'observe-job', 'create-handoff', 'migrate-state', 'recover-publication', 'reconcile-extension', 'extension-calls'];
  requireThat(o.config || o.workspace, '--config or --workspace is required');
  let store;
  const loaded = o.workspace ? (() => {
    const registered = new Store(path.resolve(o.workspace));
    try {
      const state = registered.read();
      requireThat(emergencyCommands.includes(command) || state.schema_version === 5 && command !== 'init', '--workspace requires GUI v5 for non-emergency commands');
      if (!emergencyCommands.includes(command)) requireThat(fs.realpathSync(state.project.workspace) === fs.realpathSync(o.workspace), 'Project snapshot workspace differs; explicit relocation required');
      return { config: state.config, config_hash: state.config_hash };
    } finally { registered.close(); }
  })() : loadConfig(o.config);
  if (command === 'validate-config') return { valid: true, config_hash: loaded.config_hash, effective_config: loaded.config };
  if (command === 'validate-extensions') {
    const docs = extensionDocuments(loaded.config);
    return docs ? { valid: true, fingerprint: docs.fingerprint, packages: docs.environment.packages, profiles: Object.keys(docs.spec.profiles), native_verified: false } : { enabled: false };
  }
  if (command === 'probe-backend') {
    const backend = loaded.config.backends[o.backend || loaded.config.orchestrator.backend];
    requireThat(backend?.kind === 'codex-app-server', 'Native probe currently supports codex-app-server');
    return probeCodex(backend);
  }
  if (command === 'resolve-model') return { executed: false, ...selectModel(loaded.config, {
    backend: o.backend || loaded.config.orchestrator.backend,
    ...(o['task-class'] ? { task_class: o['task-class'] } : {}), ...(o['model-tier'] ? { model_tier: o['model-tier'] } : {}) }) };
  if (command === 'capabilities') return Object.fromEntries(Object.entries(loaded.config.backends).map(([name, backend]) =>
    [name, { kind: backend.kind, executable: backend.command || null, allow_execute: backend.allow_execute,
      capabilities: capabilities(backend), live_verified: false }]));
  store ||= new Store(o.workspace ? path.resolve(o.workspace) : loaded.config.project.workspace, command === 'init');
  try {
    const legacyControl = store.read.bind(store);
    if (command !== 'init' && legacyControl().schema_version === 3 && ['control-task', 'reconcile-state', 'observe-job', 'recover-publication'].includes(command)) store.enableLegacyControl();
    if (command === 'extension-calls') return Object.values(store.read().extension_calls || {}).filter((c) => !o.attempt || c.attempt_id === o.attempt);
    if (command === 'reconcile-extension') return reconcileExtensionCall(store, o.request, o.owner, Number(o.epoch));
    if (command === 'extension-call') {
      requireThat(o.execute, 'Use --execute for an explicitly scoped extension call');
      store.assertConfig(loaded); checkOwner(store.read(), o.owner, Number(o.epoch));
      const call = readJSON(o.file);
      return runExtension(store, o.attempt, o.key, call.operation, call.arguments);
    }
    if (command === 'init') return { initialized: true, owner: store.initialize(loaded, o.owner || 'local').owner };
    if (command === 'migrate-state') return store.migrate();
    requireThat([4, 5].includes(store.read().schema_version) || store.legacyControl || ['status'].includes(command), 'Run migrate-state before operations');
    if (command === 'sync-config') return store.transaction((state) => {
      requireThat(state.schema_version !== 5, 'Use GUI change.prepare/apply for versioned v5 config changes');
      checkOwner(state, o.owner, o.epoch);
      requireThat(!publicationPending(state), 'Recover publication before changing config');
      requireThat(!Object.values(state.attempts).some((a) => ACTIVE.has(a.observed_state) || a.observed_state === 'unknown'), 'Cannot change config with active/unknown attempts');
      requireThat(state.project.id === loaded.config.project.id, 'Cannot change project ID');
      state.config_history = [...(state.config_history || []), { config_hash: state.config_hash, changed_at: now() }];
      for (const record of Object.values(state.tasks)) resolveTask(loaded.config, record.spec);
      const pools = initialPools(loaded.config);
      for (const [pid, pool] of Object.entries(pools)) {
        if (state.pools[pid]) Object.assign(pool, { ...state.pools[pid], definition: pool.definition });
      }
      state.pools = pools;
      state.config = loaded.config; state.project = loaded.config.project; state.config_hash = loaded.config_hash;
      return { updated: true, config_hash: state.config_hash };
    });
    // Controls and status must still work if someone edited the config while a task was running.
    if (!['status', 'control-task', 'reconcile-state', 'create-handoff', 'capabilities'].includes(command)) store.assertConfig(loaded);
    switch (command) {
      case 'status': {
        const s = store.read();
        return { at: now(), schema_version: s.schema_version, owner: s.owner, desired_state: s.desired_state, usage: s.usage,
          tasks: Object.fromEntries(Object.entries(s.tasks).map(([k, t]) => [k, { status: t.status, desired_state: t.desired_state, revision: t.revision, attempts: t.attempts }])),
          events: s.events, decisions: s.decisions, work_units: s.work_units, assignments: s.assignments,
          publication: s.publication || null, publications: s.publications || {}, pools: s.pools, recoveries: s.recoveries };
      }
      case 'recover-publication': {
        const result = recoverPublication(store, o.owner, o.epoch, o.action || 'complete');
        if (result.observed_state === 'completed' && result.result?.validity === 'current' && !result.final_checkpoint_id) saveFinalCheckpoint(store, result.attempt_id);
        return result.attempt_id ? store.read().attempts[result.attempt_id] : result;
      }
      case 'register-task': return registerTask(store, readJSON(o.file), o.override ? readJSON(o.override) : {});
      case 'revise-task': return reviseTask(store, readJSON(o.file), o.owner, o.epoch);
      case 'prepare-task':
      case 'run-orchestrator':
      case 'run-task': {
        if (command === 'run-orchestrator') {
          const state = store.read(), spec = state.tasks[o.task]?.spec;
          requireThat(spec?.role === 'orchestrator' && spec.backend === state.config.orchestrator.backend &&
            state.config.backends[spec.backend].kind === 'codex-app-server', 'run-orchestrator requires the configured Codex native orchestration role');
        }
        if (['run-task', 'run-orchestrator'].includes(command) && o.execute) return await runTask(store, o.task, o.owner, o.epoch, o.key);
        const state = store.read();
        requireThat(Object.hasOwn(state.tasks, o.task), 'Unknown task');
        const unit = getUnit(state, o.task, o.unit);
        const task = { ...state.tasks[o.task].spec, objective: unit.spec.objective, expected_artifacts: unit.spec.expected_artifacts };
        const context = buildContext(state.config, task, Object.values(state.decisions), state.tasks[o.task].notes || [], state);
        context.packet.work_unit = unit.spec;
        if (unit.checkpoint_id) context.packet.checkpoint = loadCheckpoint(state, unit.checkpoint_id);
        context.text = JSON.stringify(context.packet, null, 2); context.characters = context.text.length; context.sha256 = hash(context.text);
        requireThat(context.characters <= state.config.context.max_chars, 'Context with work unit/checkpoint exceeds max_chars');
        if (o.out) writeJSON(path.resolve(o.out), context.packet);
        return { executed: false, sha256: context.sha256, characters: context.characters, packet: context.packet };
      }
      case 'prepare-orchestrator': {
        const context = buildOrchestratorContext(store.read(), o['task-class'], { ...(o.tasks ? { taskIds: o.tasks.split(',') } : {}) });
        if (o.out) writeJSON(path.resolve(o.out), context.packet);
        return { executed: false, sha256: context.sha256, characters: context.characters, packet: context.packet };
      }
      case 'plan-work': {
        const state = store.read();
        return Object.values(state.work_units).filter((u) => u.task_id === o.task);
      }
      case 'allocate-budget': {
        const s = store.read(), t = s.tasks[o.task], unit = getUnit(s, o.task, o.unit);
        const context = buildContext(s.config, t.spec, Object.values(s.decisions), t.notes || [], s);
        return { executed: false, preview_only: true, ...budgetAdmission(s, t, unit, t.spec.backend, context) };
      }
      case 'save-checkpoint': return saveCheckpoint(store, o.attempt, readJSON(o.file));
      case 'prepare-recovery':
      case 'recover-task': {
        const recovery = planRecovery(store, o.task, o.owner, o.epoch, o.unit);
        if (command === 'recover-task' && o.execute && recovery.status === 'ready') {
          return await runTask(store, o.task, o.owner, o.epoch, o.key, { recoveryId: recovery.recovery_id, unitId: o.unit });
        }
        const state = store.read();
        return { ...recovery, executed: false, checkpoint: recovery.checkpoint_id ? loadCheckpoint(state, recovery.checkpoint_id) : null };
      }
      case 'update-quota': return updatePool(store, o.pool, readJSON(o.file));
      case 'record-telemetry': return recordTelemetry(store, o.attempt, readJSON(o.file));
      case 'native-requests': {
        const a = store.read().attempts[o.attempt]; requireThat(a, 'Unknown attempt');
        return { attempt_id: a.attempt_id, native: a.native || null, requests: a.native_requests || {} };
      }
      case 'inspect-native': {
        const state = store.read(), a = state.attempts[o.attempt];
        requireThat(a?.effective_config.backend.kind === 'codex-app-server', 'No native Codex attempt');
        if (!o.execute) return { executed: false, binding: a.native || null, inference_started: false };
        return await inspectCodex(a.effective_config.backend, a.native, state.project.workspace);
      }
      case 'collect-native': {
        const s = store.read(), a = s.attempts[o.attempt];
        requireThat(a?.effective_config.backend.kind === 'codex-app-server', 'No native Codex attempt');
        if (!o.execute) return { executed: false, binding: a.native || null, inference_started: false, accepted: false };
        const collected = await collectCodex(a.effective_config.backend, a.native, s.project.workspace);
        validateResult(s, a, collected.candidate);
        if (o.out) writeJSON(path.resolve(o.out), collected.candidate);
        return collected;
      }
      case 'refresh-native-quota': {
        const s = store.read(), b = s.config.backends[o.backend];
        requireThat(b?.kind === 'codex-app-server' && b.quota_pool_ids?.includes(o.pool) && o.limit,
          'Native quota requires an explicit backend/pool/limit mapping');
        if (!o.execute) return { executed: false, inference_started: false, backend: o.backend, pool: o.pool, limit: o.limit };
        const read = await readCodexQuota(b, s.project.workspace);
        const snapshot = normalizeCodexQuota(read.response, o.limit);
        return { inference_started: false, pool: updatePool(store, o.pool, snapshot) };
      }
      case 'answer-native-input': return answerNativeInput(store, o.attempt, o.request, readJSON(o.file));
      case 'register-job': return registerJob(store, o.attempt, readJSON(o.file));
      case 'observe-job': return observeJob(store, o.attempt, o.job, readJSON(o.file));
      case 'control-task': return control(store, { event_id: o.event || id('control'), action: o.action,
        target: o.target || 'project', ...(o.revision ? { expected_revision: Number(o.revision) } : {}),
        payload: o.message ? { message: o.message } : {} });
      case 'request-decision': return requestDecision(store, readJSON(o.file));
      case 'answer-decision': return answerDecision(store, o.decision, o.answer);
      case 'claim-owner': return takeOwnership(store, o.owner, o.epoch);
      case 'adopt-result': return adoptResult(store, o.attempt, o.owner, o.epoch);
      case 'import-result': {
        const state = store.read();
        const attempt = state.attempts[o.attempt];
        requireThat(attempt && ['waiting_for_result', 'unknown'].includes(attempt.observed_state), 'Import requires waiting/unknown attempt');
        requireThat(!Object.values(state.events).some((e) => e.action === 'cancel' && e.affected_attempts.includes(o.attempt)), 'Cancelled attempt output requires manual reconciliation rather than import');
        if (attempt.observed_state === 'unknown') verifyResultTermination(store, o.attempt, o.observation ? readJSON(o.observation) : {}, o.owner, o.epoch);
        const result = validateResult(store.read(), store.read().attempts[o.attempt], readJSON(o.file));
        if (attempt.observed_state === 'unknown' && attempt.effective_config.backend.kind === 'codex-app-server')
          result.usage = { input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_usd: null };
        const finished = await completeAttempt(store, o.attempt, { status: result.status === 'completed' ? 'completed' : 'failed', result });
        if (finished.observed_state === 'completed' && finished.result?.validity === 'current') saveFinalCheckpoint(store, o.attempt);
        return store.read().attempts[o.attempt];
      }
      case 'reconcile-state': return reconcile(store, o.file ? readJSON(o.file) : []);
      case 'record-run': return recordRun(store, readJSON(o.file));
      case 'record-claim': return recordClaim(store, readJSON(o.file));
      case 'record-research': case 'record-domain': {
        const domain = projectDomain(store.read());
        requireThat(command === 'record-domain' || domain.id === 'research', 'Research command requires a Research project');
        return domain.record(store, readJSON(o.file), o.owner, o.epoch, o.attempt);
      }
      case 'read-research': case 'read-domain': {
        const s = store.read(), domain = projectDomain(s);
        requireThat(command === 'read-domain' || domain.id === 'research', 'Research command requires a Research project');
        const entry = domain.entry(s, o.record, o.revision ? Number(o.revision) : undefined);
        return { ...entry, validity: domain.validity(s, entry) };
      }
      case 'review-research': case 'review-domain': {
        const s = store.read(), domain = projectDomain(s);
        requireThat(command === 'review-domain' || domain.id === 'research', 'Research command requires a Research project');
        return domain.review(s, o.task);
      }
      case 'export-research': case 'export-domain': {
        const s = store.read(), domain = projectDomain(s);
        requireThat(command === 'export-domain' || domain.id === 'research', 'Research command requires a Research project');
        const result = domain.render(s, o.task);
        requireThat(!o.format || ['json', 'markdown'].includes(o.format), 'Unknown export format');
        if (o.out) {
          if (o.format === 'markdown') writeText(path.resolve(o.out), result.markdown);
          else writeJSON(path.resolve(o.out), result);
        }
        return o.format === 'markdown' ? result.markdown : result;
      }
      case 'hash-artifact': {
        const file = confined(store.read().project.workspace, o.file);
        requireThat(fs.statSync(file).isFile(), 'Expected an artifact file');
        return { path: o.file, sha256: hash(fs.readFileSync(file)) };
      }
      case 'propose-improvement': return proposeImprovement(store, readJSON(o.file), o.owner, o.epoch);
      case 'activate-improvement': return activateImprovement(store, o.change, o.owner, o.epoch);
      case 'list-improvements': return store.read().improvements || { active: null, changes: {}, events: [] };
      case 'reopen-task': return reopenTask(store, o.task, readJSON(o.file), o.owner, o.epoch);
      case 'request-benchmark': return requestBenchmark(store, readJSON(o.file), o.owner, o.epoch);
      case 'confirm-benchmark': return confirmBenchmark(store, o.request, readJSON(o.file), o.owner, o.epoch);
      case 'supersede-benchmark': return supersedeBenchmark(store, o.request, readJSON(o.file), o.owner, o.epoch);
      case 'collect-results': return collectResults(store.read());
      case 'report-usage': return usageReport(store.read());
      case 'check-evidence': return checkEvidence(store.read());
      case 'verify-artifacts': return verifyArtifacts(store.read(), readJSON(o.file));
      case 'create-handoff': {
        const result = handoff(store.read());
        if (o.out) writeJSON(path.resolve(o.out), result);
        return result;
      }
      default: throw new Error('Unknown command: ' + command);
    }
  } finally { store.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((result) => {
    process.stdout.write((typeof result === 'string' ? result : JSON.stringify(result, null, 2)) + '\n');
    if (result?.passed === false || result?.allowed === false || result?.remaining_work_status === 'waiting_for_capacity' ||
      (result?.observed_state && ['failed', 'unknown', 'cancelled'].includes(result.observed_state)) ||
      (result?.result?.validity && result.result.validity !== 'current')) process.exitCode = 1;
  }).catch((error) => { process.stderr.write(JSON.stringify({ error: error.message,
    ...(error.correlation ? { correlation: error.correlation } : {}), ...(error.logging_unavailable ? { logging_unavailable: true } : {}) }) + '\n');
    process.exitCode = error.code === 'INSPECT_USAGE' || error.code?.startsWith('ERR_PARSE_ARGS') ? 2 : 1; });
}
