import fs from 'node:fs';
import { executionRoot, isolated, reserveWorkspace, publicationPending } from './workspaces.mjs';
import path from 'node:path';
import { id, now, clone, requireThat, artifactCheck, confined, hash, fileHash } from './util.mjs';
import { contract } from './schema.mjs';
import { resolveTask } from './config.mjs';
import { buildContext } from './context.mjs';
import { capabilities } from '../adapters/index.mjs';
import { installUnits, getUnit, workKey, assignmentCurrent, completeUnit, publicationOrder } from './work.mjs';
import { estimateUnit, budgetAdmission, poolIds, settleUsage } from './resources.mjs';
import { loadCheckpoint } from './checkpoints.mjs';
import { classifyFailure } from './failures.mjs';
import { researchState } from './research.mjs';
import { benchmarkAdmission, benchmarkDispatchAllowed, benchmarkFinished } from './benchmarks.mjs';
import { modelForBackend } from './models.mjs';
import { validatePlanningReview } from './planning.mjs';
import { pinOutputs, checkAttemptRef } from './receipts.mjs';

import { resolveExtensions } from './extensions.mjs';
import { extensionArtifacts } from './extension-runner.mjs';

export const ACTIVE = new Set(['dispatching', 'running', 'waiting_for_result', 'cancel_requested', 'pause_requested', 'yielding']);
export const hasLiveJobs = (attempt) => attempt.job_refs.some((j) => ['external', 'extension'].includes(j.kind) && !['completed', 'failed', 'cancelled', 'stopped'].includes(j.observed_state));
export const terminal = (attempt) => !ACTIVE.has(attempt.observed_state) && attempt.observed_state !== 'unknown' && !hasLiveJobs(attempt);
export function checkOwner(state, owner, epoch) {
  requireThat(owner === state.owner.id && Number(epoch) === state.owner.epoch, 'Stale or invalid orchestration owner/epoch');
}
function taskAt(state, taskId) {
  const task = Object.hasOwn(state.tasks, taskId) ? state.tasks[taskId] : null;
  requireThat(task, 'Unknown task: ' + taskId);
  return task;
}
function inputSnapshotCurrent(state, attempt) {
  return (attempt.input_refs || []).every((ref) => {
    try { return fileHash(confined(state.project.workspace, ref.path)) === ref.sha256; } catch { return false; }
  });
}
function evidenceCurrent(state, attempt) {
  if (!attempt?.result || !inputSnapshotCurrent(state, attempt)) return false;
  try {
    [...attempt.result.artifacts, ...attempt.result.evidence_refs].forEach((ref) => checkAttemptRef(state, attempt, ref));
    return true;
  } catch { return false; }
}
export function currentTaskResult(state, taskId, seen = new Set()) {
  if (seen.has(taskId)) return false;
  if (publicationPending(state) && state.attempts[state.publications[state.publication].attempt_id]?.task_id === taskId) return false;
  const task = state.tasks[taskId];
  if (!task || !['completed', 'paused'].includes(task.status) || task.result?.validity !== 'current') return false;
  try { task.result.artifacts.forEach((ref) => artifactCheck(state.project.workspace, ref)); } catch { return false; }
  const attempt = state.attempts[task.result.attempt_id];
  if (!attempt || hasLiveJobs(attempt) || attempt.task_revision !== task.revision || !evidenceCurrent(state, attempt)) return false;
  for (const uid of task.unit_ids || []) {
    const unit = state.work_units[workKey(taskId, uid)];
    if (unit?.status !== 'completed' || !evidenceCurrent(state, state.attempts[unit.result?.attempt_id])) return false;
  }
  const nextSeen = new Set([...seen, taskId]);
  return task.spec.dependencies.every((dep) => currentTaskResult(state, dep, nextSeen));
}
function refreshControlEvents(state) {
  for (const event of Object.values(state.events)) {
    if (!['pause', 'cancel'].includes(event.action)) continue;
    event.outcomes = Object.fromEntries(event.affected_attempts.map((aid) => [aid, state.attempts[aid].observed_state]));
    event.status = event.affected_attempts.every((aid) => terminal(state.attempts[aid])) ? 'verified' :
      event.affected_attempts.some((aid) => state.attempts[aid].observed_state === 'unknown') ? 'unverified' : 'applied';
    event.updated_at = now();
  }
}
export function scopeTasks(state, target) {
  if (target === 'project') return Object.values(state.tasks);
  return [taskAt(state, target)];
}
export function registerTask(store, input, override = {}, options = {}) {
  return store.transaction((state) => {
    if (options.parentAttemptId) {
      const parent = state.attempts[options.parentAttemptId];
      requireThat(parent && !parent.settled && parent.effective_config.role === 'orchestrator' && dispatchAllowed(state, parent.attempt_id, parent.runner_token), 'Stale orchestration parent');
    }
    const task = resolveTask(state.config, input, override);
    requireThat(!Object.hasOwn(state.tasks, task.task_id), 'Task already registered; use revise-task');
    for (const dependency of task.dependencies) requireThat(Object.hasOwn(state.tasks, dependency), 'Register dependencies first: ' + dependency);
    state.tasks[task.task_id] = { spec: task, status: 'queued', desired_state: 'running',
      revision: task.task_revision, attempts: [], created_at: now() };
    if (options.parentAttemptId) state.tasks[task.task_id].orchestration_attempt_id = options.parentAttemptId;
    installUnits(state, task);
    return state.tasks[task.task_id];
  });
}
export function reviseTask(store, input, owner, epoch) {
  return store.transaction((state) => {
    checkOwner(state, owner, epoch);
    const existing = taskAt(state, input.task_id);
    requireThat(!existing.attempts.some((aid) => ACTIVE.has(state.attempts[aid].observed_state) || state.attempts[aid].observed_state === 'unknown'), 'Resolve active/unknown attempts before revising');
    const task = resolveTask(state.config, input);
    requireThat(task.task_revision === existing.revision + 1, 'Revision must increase by exactly one');
    for (const dependency of task.dependencies) requireThat(Object.hasOwn(state.tasks, dependency) && dependency !== task.task_id, 'Invalid dependency');
    const reaches = (candidate, seen = new Set()) => {
      if (candidate === task.task_id) return true;
      if (seen.has(candidate)) return false;
      seen.add(candidate);
      return state.tasks[candidate].spec.dependencies.some((parent) => reaches(parent, seen));
    };
    requireThat(!task.dependencies.some((dependency) => reaches(dependency)), 'Dependency cycle');
    existing.history = [...(existing.history || []), clone(existing.spec)];
    existing.spec = task; existing.revision = task.task_revision; existing.status = 'queued'; existing.desired_state = 'running';
    state.work_unit_history = [...(state.work_unit_history || []), ...existing.unit_ids.map((uid) => clone(state.work_units[workKey(task.task_id, uid)]))];
    installUnits(state, task);
    delete existing.result; delete existing.suspended_status;
    for (const decision of Object.values(state.decisions)) {
      if (decision.status === 'pending' && decision.affected_tasks.includes(task.task_id)) {
        decision.status = 'superseded'; decision.superseded_at = now();
        for (const affectedTask of decision.affected_tasks) {
          if (affectedTask !== task.task_id && state.tasks[affectedTask].status === 'waiting_for_user') state.tasks[affectedTask].status = 'needs_review';
        }
      }
    }
    const affected = new Set([task.task_id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of Object.values(state.tasks)) {
        if (!affected.has(t.spec.task_id) && t.spec.dependencies.some((d) => affected.has(d))) {
          affected.add(t.spec.task_id); changed = true;
        }
      }
    }
    for (const tid of affected) {
      for (const aid of state.tasks[tid].attempts) {
        if (state.attempts[aid].result) state.attempts[aid].result.validity = 'stale_dependency';
      }
      if (tid !== task.task_id) {
        state.tasks[tid].status = 'needs_review';
        if (state.tasks[tid].result) state.tasks[tid].result.validity = 'stale_dependency';
      }
    }
    return { task: existing, invalidated_tasks: [...affected] };
  });
}

function decisionBlockers(state, task) {
  const replaces = (next, id) => {
    const seen = new Set();
    while (next?.supersedes_decision_id && !seen.has(next.decision_id)) {
      seen.add(next.decision_id);
      if (next.supersedes_decision_id === id) return true;
      next = state.decisions[next.supersedes_decision_id];
    }
    return false;
  };
  return Object.values(state.decisions).filter((d) => d.status === 'answered' && d.answer === 'decline' &&
    d.affected_tasks.includes(task.spec.task_id) && d.task_revisions[task.spec.task_id] === task.revision &&
    !Object.values(state.decisions).some((next) => next.status === 'answered' && next.answer === 'approve' && replaces(next, d.decision_id)));
}

// Explicit local review; never resets attempts, budgets, generations or scientific history.
export function reopenTask(store, taskId, review, owner, epoch) {
  contract('task-review', review);
  return store.transaction((state) => {
    checkOwner(state, owner, epoch);
    const task = taskAt(state, taskId);
    requireThat(task.status === 'needs_review', 'Only needs_review tasks can be reopened');
    requireThat(task.desired_state !== 'cancelled' && state.desired_state !== 'cancelled', 'Cancelled work cannot be reopened');
    requireThat(!task.attempts.some((aid) => !state.attempts[aid].settled || hasLiveJobs(state.attempts[aid])), 'Resolve active/unknown attempts before review');
    requireThat(!Object.values(state.decisions).some((d) => d.status === 'pending' && d.affected_tasks.includes(taskId)) && !decisionBlockers(state, task).length,
      'Resolve pending or declined decisions before reopening');
    requireThat(task.spec.dependencies.every((dep) => currentTaskResult(state, dep)), 'Dependency requires review');
    task.spec.inputs.forEach((ref) => { if (ref.sha256) artifactCheck(state.project.workspace, ref); });
    review.evidence?.forEach((ref) => artifactCheck(state.project.workspace, ref));
    const units = task.unit_ids.map((uid) => state.work_units[workKey(taskId, uid)]);
    const rerun = new Set(review.rerun_units || []);
    requireThat([...rerun].every((uid) => task.unit_ids.includes(uid)), 'Unknown review work unit');
    for (const u of units) {
      const a = state.attempts[u.result?.attempt_id];
      if (u.status !== 'completed' || !a || a.result?.validity !== 'current' || !evidenceCurrent(state, a)) rerun.add(u.spec.work_unit_id);
    }
    for (const u of units) if (u.spec.dependencies.some((uid) => rerun.has(uid))) rerun.add(u.spec.work_unit_id);
    requireThat(rerun.size > 0, 'Completed results need adopt-result or explicit rerun_units');
    const preserved = units.filter((u) => !rerun.has(u.spec.work_unit_id)).map((u) => u.spec.work_unit_id);
    for (const u of units.filter((u) => rerun.has(u.spec.work_unit_id))) {
      u.history = [...(u.history || []), { result: clone(u.result || null), status: u.status, checkpoint_id: u.checkpoint_id }];
      u.status = 'queued'; delete u.result; u.checkpoint_id = null;
    }
    task.review_history = [...(task.review_history || []), { ...clone(review), at: now(), owner, epoch: Number(epoch), rerun_units: [...rerun], preserved_units: preserved }];
    delete task.result;
    task.status = task.desired_state === 'paused' ? 'paused' : 'queued';
    if (task.desired_state === 'paused') task.suspended_status = 'queued';
    return { task_id: taskId, revision: task.revision, status: task.status, rerun_units: [...rerun], preserved_units: preserved };
  });
}

function granted(state, task, action) {
  return state.config.autonomy.grants.some((g) => g.actions.includes(action) && (g.task_ids.includes('*') || g.task_ids.includes(task.task_id))) ||
    Object.values(state.decisions).some((d) => d.status === 'answered' && d.answer === 'approve' &&
      d.grant_actions.includes(action) && d.affected_tasks.includes(task.task_id) && d.task_revisions[task.task_id] === task.task_revision);
}
export function reservations(state) {
  return Object.values(state.attempts).filter((a) => !a.settled).reduce((r, a) => ({
    tokens: r.tokens + a.reservation_tokens, cost_usd: r.cost_usd + a.reservation_cost_usd
  }), { tokens: 0, cost_usd: 0 });
}
export function beginAttempt(store, taskId, owner, epoch, dispatchKey, options = {}) {
  return store.transaction((state) => {
    checkOwner(state, owner, epoch);
    requireThat([4, 5].includes(state.schema_version), 'Migrate state before execution');
    requireThat(!publicationPending(state), 'Recover pending publication before dispatch');
    requireThat(typeof dispatchKey === 'string' && dispatchKey.length > 0, 'dispatch_key is required');
    const duplicate = Object.values(state.attempts).find((a) => a.dispatch_key === dispatchKey);
    if (duplicate) {
      requireThat(duplicate.task_id === taskId && duplicate.task_revision === taskAt(state, taskId).revision, 'Dispatch key belongs to another task/revision');
      return { attempt: duplicate, duplicate: true };
    }
    const record = taskAt(state, taskId);
    const unit = getUnit(state, taskId, options.unitId);
    const baseTask = record.spec;
    if (record.orchestration_attempt_id) {
      const parent = state.attempts[record.orchestration_attempt_id];
      requireThat(parent && dispatchAllowed(state, parent.attempt_id, parent.runner_token), 'Parent orchestration barrier is closed');
    }
    const recovery = options.recoveryId ? state.recoveries[options.recoveryId] : null;
    if (options.recoveryId) requireThat(recovery?.status === 'ready' && recovery.task_id === taskId &&
      recovery.work_unit_id === unit.spec.work_unit_id && recovery.source_generation === unit.generation, 'Stale or invalid recovery transfer');
    const backendName = recovery?.target_backend || baseTask.backend;
    const task = { ...modelForBackend(state.config, baseTask, backendName),
      objective: unit.spec.objective, expected_artifacts: unit.spec.expected_artifacts,
      ...(unit.spec.mock ? { mock: clone(unit.spec.mock) } : {}) };
    if (recovery && backendName !== state.attempts[recovery.source_attempt_id].backend) task.mock = { ...(task.mock || {}), ...(state.config.backends[backendName].kind === 'mock' ? { failure_code: undefined, yield_after_ms: undefined } : {}) };
    requireThat(state.desired_state === 'running' && record.desired_state === 'running', 'Dispatch blocked by pause/cancel');
    requireThat(['queued', 'failed', 'yielded', 'waiting_for_capacity'].includes(record.status), 'Task is not dispatchable: ' + record.status);
    requireThat(!unit.attempts.some((aid) => ACTIVE.has(state.attempts[aid].observed_state) || state.attempts[aid].observed_state === 'unknown'), 'Reconcile previous unit attempt before dispatch');
    requireThat(unit.attempts.length < state.config.recovery_policy.max_segments_per_unit, 'Work unit segment budget exhausted');
    for (const dep of task.dependencies) {
      const dependency = state.tasks[dep];
      requireThat(dependency.status === 'completed' && currentTaskResult(state, dep), 'Dependency not accepted/current: ' + dep);
    }
    requireThat(!decisionBlockers(state, record).length, 'A declined decision still blocks this task');
    const unresolved = Object.values(state.decisions).find((d) => d.status === 'pending' && d.affected_tasks.includes(taskId));
    requireThat(!unresolved, 'Waiting for decision: ' + unresolved?.decision_id);
    for (const action of task.required_actions) requireThat(granted(state, task, action), 'Missing authorization for action: ' + action);
    const backend = state.config.backends[task.backend];
    if (!['mock', 'manual'].includes(backend.kind)) {
      requireThat(state.config.execution.allow_external && backend.allow_execute, 'External execution disabled until user verification');
    }
    requireThat(backend.allow_execute || backend.kind === 'manual', 'Backend execution is disabled');
    const inFlight = Object.values(state.attempts).filter((a) => ACTIVE.has(a.observed_state) || a.observed_state === 'unknown');
    requireThat(inFlight.length < state.config.execution.max_concurrent, 'Concurrency limit reached (unknown jobs count as active)');
    if (task.writes_workspace) {
      const writers = inFlight.filter((a) => state.tasks[a.task_id].spec.writes_workspace);
      const policy = state.config.workspace_policy;
      requireThat(policy?.mode === 'snapshot_directory' ?
        writers.every((a) => isolated(a)) && writers.length < policy.max_writers : writers.length === 0,
        'Concurrent writers require isolated workspaces and available writer capacity');
    }
    requireThat(record.attempts.length < task.budget.max_attempts, 'Task attempt budget exhausted');
    requireThat(Object.keys(state.attempts).length < state.config.execution.max_attempts, 'Project attempt budget exhausted');
    // Read/hash the input snapshot while dispatch is serialized. No asynchronous work in the transaction.
    const context = buildContext(state.config, task, Object.values(state.decisions), record.notes || [], state);
    context.packet.work_unit = { work_unit_id: unit.spec.work_unit_id, objective: unit.spec.objective,
      completed_units: record.unit_ids.filter((uid) => state.work_units[workKey(taskId, uid)].status === 'completed'),
      remaining_units: record.unit_ids.filter((uid) => state.work_units[workKey(taskId, uid)].status !== 'completed') };
    let checkpoint = null;
    const checkpointId = recovery ? recovery.checkpoint_id : unit.checkpoint_id;
    if (checkpointId) { checkpoint = loadCheckpoint(state, checkpointId); context.packet.checkpoint = checkpoint; }
    const estimate = estimateUnit(unit, state, backendName, { ...record, spec: task });
    let benchmark;
    const assignmentId = id('assignment');
    const attempt = {
      attempt_id: id('attempt'), task_id: taskId, task_revision: task.task_revision, protocol_version: task.protocol_version,
      owner_epoch: state.owner.epoch, backend: task.backend, dispatch_key: dispatchKey,
      desired_state: 'running', observed_state: 'dispatching', job_refs: [],
      timestamps: { created_at: now() }, runner_pid: process.pid, runner_token: id('runner'),
      reservation_tokens: estimate.tokens, reservation_cost_usd: estimate.cost_usd,
      settled: false, context_hash: context.sha256, context_characters: context.characters,
      effective_config: { backend: clone(backend), role: task.role, model: task.model, reasoning_effort: task.reasoning_effort,
        model_tier: task.model_tier || null, model_selection: task.model_selection, skills: task.skills, budget: task.budget },
      ...(task.extension_profile && task.extension_profile !== 'none' ? { extension_binding: resolveExtensions(state.config, task) } : {}),
      config_hash: state.config_hash, work_unit_id: unit.spec.work_unit_id,
      research_refs: (context.packet.research?.records || []).map((e) => ({ record_id: e.record.record_id, revision: e.record.revision, sha256: e.sha256 })),
      bundle_refs: context.packet.bundle_refs,
      ...(benchmark ? { benchmark_request_id: benchmark.request_id } : {}),
      assignment_id: assignmentId, assignment_generation: unit.generation + 1,
      quota_pool_ids: poolIds(state.config, backendName), resumed_from_checkpoint: checkpoint?.checkpoint_id || null,
      supersedes_attempt_id: recovery?.source_attempt_id || null, recovery_id: recovery?.recovery_id || null
    };
    reserveWorkspace(state, attempt);
    attempt.input_refs = context.packet.inputs.map(({ path, sha256 }) => ({ path, sha256 }));
    context.packet.dispatch = { attempt_id: attempt.attempt_id, task_revision: attempt.task_revision,
      created_at: attempt.timestamps.created_at,
      protocol_version: attempt.protocol_version, owner_epoch: attempt.owner_epoch,
      assignment_generation: attempt.assignment_generation, work_unit_id: attempt.work_unit_id };
    context.text = JSON.stringify(context.packet, null, 2);
    requireThat(context.text.length <= state.config.context.max_chars, 'Context with dispatch identity exceeds max_chars');
    context.sha256 = hash(context.text); context.characters = context.text.length;
    attempt.context_hash = context.sha256; attempt.context_characters = context.characters;
    const admission = budgetAdmission(state, { ...record, spec: task }, unit, backendName, context, Boolean(recovery));
    if (!admission.allowed) throw Object.assign(new Error(admission.message), { code: 'RESOURCE_ADMISSION', admission });
    benchmark = benchmarkAdmission(state, task, admission.estimate);
    if (benchmark) attempt.benchmark_request_id = benchmark.request_id;
    attempt.reservation_tokens = admission.estimate.tokens;
    attempt.admission = admission;
    unit.generation = attempt.assignment_generation; unit.assignment_id = assignmentId;
    unit.status = 'running'; unit.attempts.push(attempt.attempt_id);
    state.assignments[assignmentId] = { assignment_id: assignmentId, task_id: taskId,
      work_unit_id: unit.spec.work_unit_id, generation: unit.generation, backend: backendName, attempt_id: attempt.attempt_id,
      owner_epoch: state.owner.epoch, heartbeat_at: now(), lease_expires_at: new Date(Date.now() + state.config.checkpoint_policy.lease_ms).toISOString(), status: 'active' };
    if (recovery) {
      const source = state.attempts[recovery.source_attempt_id];
      if (source.observed_state !== 'yielded' && source.backend === backendName) unit.retries++;
      if (source.backend !== backendName) unit.transfers++;
      if (source.observed_state === 'yielded') unit.yields++;
      unit.no_progress_recoveries = unit.progress_fingerprint === recovery.progress_fingerprint ? (unit.no_progress_recoveries || 0) + 1 : 0;
      unit.progress_fingerprint = recovery.progress_fingerprint;
      state.assignments[source.assignment_id].status = 'superseded';
      recovery.status = 'transferred'; recovery.attempt_id = attempt.attempt_id;
    }
    contract('attempt', attempt);
    if (benchmark) { benchmark.status = 'started'; benchmark.started_at ||= now(); }
    state.attempts[attempt.attempt_id] = attempt;
    record.attempts.push(attempt.attempt_id); record.status = 'running';
    return { attempt, context, task: clone(task), backend: clone(backend), duplicate: false };
  });
}
export function dispatchAllowed(state, attemptId, runnerToken) {
  const a = state.attempts[attemptId];
  return a && benchmarkDispatchAllowed(state, a) && assignmentCurrent(state, a) && a.runner_token === runnerToken && a.owner_epoch === state.owner.epoch &&
    state.desired_state === 'running' && taskAt(state, a.task_id).desired_state === 'running' && a.desired_state === 'running';
}
function settle(state, attempt, usage) {
  settleUsage(state, attempt, usage);
}
export function validateResult(state, attempt, result) {
  const trusted = extensionArtifacts(state, attempt);
  if (Array.isArray(result?.artifacts)) for (const ref of trusted) {
    const prior = result.artifacts.find((r) => r.path === ref.path);
    requireThat(!prior || prior.sha256 === undefined || prior.sha256 === ref.sha256, 'Extension artifact identity changed');
    if (!prior) result.artifacts.push({ path: ref.path, sha256: ref.sha256 }); else prior.sha256 = ref.sha256;
  }
  // Only declared writable outputs may omit a hash. Historical inputs/evidence/audit remain strict.
  const root = executionRoot(state, attempt);
  const taskSpec = taskAt(state, attempt.task_id).spec;
  const outputUnit = state.work_units[workKey(attempt.task_id, attempt.work_unit_id)];
  const allowedOutputs = new Set([...taskSpec.expected_artifacts, ...outputUnit.spec.expected_artifacts]);
  for (const ref of Array.isArray(result?.artifacts) ? result.artifacts : []) {
    if (ref && typeof ref.path === 'string' && ref.sha256 === undefined) {
      requireThat(taskSpec.writes_workspace && allowedOutputs.has(ref.path), 'Hash omission is only allowed for declared writable outputs');
      const file = confined(root, ref.path);
      const canonical = (p) => { const actual = fs.realpathSync(p); return process.platform === 'win32' ? actual.toLowerCase() : actual; };
      requireThat(!(attempt.input_refs || []).some((input) => canonical(confined(root, input.path)) === canonical(file)), 'Historical input hashes cannot be pinned at result time');
      ref.sha256 = fileHash(file);
    }
  }
  contract('result', result);
  requireThat(result.task_id === attempt.task_id && result.task_revision === attempt.task_revision &&
    result.attempt_id === attempt.attempt_id && result.protocol_version === attempt.protocol_version, 'Result identity/revision mismatch');
  const spec = taskAt(state, attempt.task_id).spec;
  for (const artifact of [...result.artifacts, ...result.evidence_refs]) artifactCheck(root, artifact);
  const unit = state.work_units[workKey(attempt.task_id, attempt.work_unit_id)];
  if (result.status === 'completed') for (const required of unit.spec.expected_artifacts) requireThat(result.artifacts.some((a) => a.path === required), 'Missing expected artifact: ' + required);
  if (result.status === 'completed') {
    requireThat(result.checks.length > 0 && result.checks.every((c) => c.passed), 'Completed result has missing or failed checks');
    const others = taskAt(state, attempt.task_id).unit_ids.filter((uid) => uid !== attempt.work_unit_id)
      .map((uid) => state.work_units[workKey(attempt.task_id, uid)]);
    if (others.every((u) => u.status === 'completed')) {
      const paths = new Set([...result.artifacts, ...others.flatMap((u) => u.result?.artifacts || [])].map((r) => r.path));
      requireThat(spec.expected_artifacts.every((p) => paths.has(p)), 'Task is missing expected artifacts');
      const latest = new Map([...publicationOrder(others).flatMap((u) => u.result?.artifacts || []), ...result.artifacts].map((ref) => [ref.path, ref]));
      latest.forEach((ref) => artifactCheck(result.artifacts.some((r) => r.path === ref.path) ? root : state.project.workspace, ref));
      requireThat(others.every((u) => evidenceCurrent(state, state.attempts[u.result?.attempt_id])), 'Completed unit evidence changed; review affected units');
    }
  }
  const planningSources = validatePlanningReview(state, attempt, result);
  for (const ref of planningSources) {
    if (!result.evidence_refs.some((r) => r.path === ref.path && r.sha256 === ref.sha256)) result.evidence_refs.push(clone(ref));
  }
  if (result.usage.cached_input_tokens !== null && result.usage.input_tokens !== null) requireThat(result.usage.cached_input_tokens <= result.usage.input_tokens, 'Cached tokens exceed total input');
  return result;
}
export function finishAttempt(store, attemptId, outcome) {
  return store.transaction((state) => {
    const attempt = state.attempts[attemptId];
    requireThat(attempt, 'Unknown attempt');
    if (attempt.settled && terminal(attempt)) {
      if (outcome.result && !attempt.result) {
        attempt.late_deliveries = [...(attempt.late_deliveries || []), { received_at: now(), result: clone(outcome.result), validity: 'late_not_integrated' }];
      }
      return attempt;
    }
    requireThat(!publicationPending(state) || state.publications[state.publication].attempt_id === attemptId && outcome.result?.status === 'completed',
      'Recover pending publication before finishing work');
    const task = taskAt(state, attempt.task_id);
    const current = assignmentCurrent(state, attempt);
    const unit = state.work_units[workKey(attempt.task_id, attempt.work_unit_id)];
    if (outcome.not_dispatched) {
      requireThat(attempt.observed_state === 'dispatching' && !attempt.job_refs.length && !outcome.result,
        'Only an unsubmitted dispatch can be settled without model usage');
      outcome = { ...outcome, usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cost_usd: 0 } };
    }
    attempt.timestamps.ended_at = now();
    attempt.observed_state = outcome.status;
    attempt.error = outcome.error || null;
    attempt.job_refs = outcome.jobs || attempt.job_refs;
    if (outcome.result) {
      if (isolated(attempt) && outcome.result.status === 'completed') {
        const j = state.publications?.[attempt.publication_id];
        requireThat(j?.status === 'pending' && j.phase === 'files_installed' && state.publication === j.publication_id &&
          hash(JSON.stringify(j.outcome.result)) === hash(JSON.stringify(outcome.result)), 'Isolated result requires journaled publication');
      }
      validateResult(state, attempt, outcome.result);
      const validity = current && inputSnapshotCurrent(state, attempt) && attempt.owner_epoch === state.owner.epoch && attempt.task_revision === task.revision &&
        task.spec.dependencies.every((dep) => currentTaskResult(state, dep)) ? 'current' : 'stale_inputs_owner_or_revision';
      attempt.result = { ...clone(outcome.result), validity };
      if (current) {
        if (validity === 'current' && outcome.result.status === 'completed') { pinOutputs(state, attempt, attempt.result); completeUnit(state, attempt); }
        else { task.result = clone(attempt.result); task.status = 'needs_review'; unit.status = 'needs_review'; }
      }
      if (outcome.session_id) attempt.session_id = outcome.session_id;
    } else if (current) {
      task.status = outcome.status === 'unknown' ? 'unknown' : outcome.status === 'yielded' ? 'yielded' :
        outcome.status === 'cancelled' ? 'cancelled' : 'failed';
      unit.status = task.status;
    }
    if (outcome.failure) attempt.failure = clone(outcome.failure);
    else if (!outcome.result) attempt.failure = classifyFailure({ code: outcome.error === 'timeout' ? 'timeout' : undefined, message: outcome.error || '' });
    if (attempt.failure && ['quota_exhausted', 'rate_limit'].includes(attempt.failure.reason)) {
      for (const pid of attempt.quota_pool_ids) {
        const pool = state.pools[pid]; pool.total_failures = (pool.total_failures ?? pool.failures) + 1; pool.failures++;
        pool.last_failure_reason = attempt.failure.reason;
        pool.last_failure_at = now();
        const base = state.config.recovery_policy.cooldown_ms;
        const delay = Math.max(attempt.failure.retry_after_ms || 0, Math.min(60000, base * 2 ** Math.min(pool.failures - 1, 6)));
        pool.cooldown_until = new Date(Date.now() + delay + Math.floor(Math.random() * Math.min(base / 10, 100))).toISOString();
      }
    }
    if (outcome.result?.status === 'completed' && current && attempt.result?.validity === 'current') {
      for (const pid of attempt.quota_pool_ids) state.pools[pid].failures = 0;
    }
    state.assignments[attempt.assignment_id].status = outcome.status === 'unknown' ? 'unknown' : 'ended';
    if (attempt.recovery_id) {
      const recovery = state.recoveries[attempt.recovery_id];
      recovery.completed_at = now();
      recovery.outcome = outcome.result?.status === 'completed' && current ? 'structural_completion' : outcome.status;
    }
    // Unknown descendants retain their reservations and block retry until reconciled.
    if (outcome.status !== 'unknown' && !hasLiveJobs(attempt)) {
      const telemetry = attempt.telemetry?.totals;
      settle(state, attempt, outcome.result?.usage || outcome.usage || (telemetry ? { ...telemetry, cached_input_tokens: null } : null));
    }
    if (outcome.not_dispatched && current && task.desired_state !== 'cancelled' && state.desired_state !== 'cancelled') {
      unit.status = 'queued';
      task.status = task.desired_state === 'paused' || state.desired_state === 'paused' ? 'paused' : 'queued';
      task.suspended_status = 'queued';
    }
    if (attempt.publication_id && state.publications[attempt.publication_id]?.status === 'pending') {
      const j = state.publications[attempt.publication_id];
      requireThat(attempt.result?.validity === 'current' && outcome.result.status === 'completed', 'Publication lost acceptance fencing');
      j.status = 'accepted'; j.ended_at = now(); state.publication = null;
    }
    benchmarkFinished(state, attempt);
    refreshControlEvents(state);
    return attempt;
  });
}
export function control(store, request) {
  contract('control', request);
  return store.transaction((state) => {
    const prior = Object.hasOwn(state.events, request.event_id) ? state.events[request.event_id] : null;
    if (prior) {
      requireThat(prior.request_hash === hash(JSON.stringify(request)), 'Event ID reused with a different request');
      return prior;
    }
    const tasks = scopeTasks(state, request.target);
    if (request.expected_revision !== undefined) requireThat(tasks.every((t) => t.revision === request.expected_revision), 'Stale control revision');
    const attempts = tasks.flatMap((t) => t.attempts).filter((aid) => ACTIVE.has(state.attempts[aid].observed_state) || state.attempts[aid].observed_state === 'unknown' || hasLiveJobs(state.attempts[aid]));
    const event = { ...clone(request), request_hash: hash(JSON.stringify(request)), received_at: now(), updated_at: now(),
      status: 'received', affected_tasks: tasks.map((t) => t.spec.task_id), affected_attempts: attempts };
    state.events[event.event_id] = event;
    if (request.action === 'status') { event.status = 'verified'; return event; }
    if (request.action === 'steer') {
      requireThat(typeof request.payload.message === 'string' && request.payload.message.trim(), 'Steer needs payload.message');
      event.status = attempts.length ? 'pending' : 'deferred';
      for (const t of tasks) t.notes = [...(t.notes || []), { event_id: event.event_id, message: request.payload.message }];
      return event;
    }
    if (request.action === 'resume') {
      const manualWaiting = (aid) => {
        const a = state.attempts[aid];
        return a.observed_state === 'waiting_for_result' && !a.job_refs.length && a.effective_config.backend.kind === 'manual' && a.desired_state === 'paused';
      };
      requireThat(attempts.every(manualWaiting), 'Cannot resume while active or unknown attempts exist; reconcile first');
      if (request.target === 'project') {
        requireThat(state.desired_state !== 'cancelled', 'Cancelled project requires a new project; cancellation is terminal');
        state.desired_state = 'running';
      } else requireThat(state.desired_state === 'running', 'Resume project barrier first');
      for (const t of tasks) {
        if (t.desired_state === 'cancelled') continue;
        t.desired_state = 'running';
        for (const aid of t.attempts.filter(manualWaiting)) state.attempts[aid].desired_state = 'running';
        if (t.status === 'paused' || t.status === 'pause_requested') {
          if (t.suspended_status === 'running' && !t.attempts.some((aid) => state.attempts[aid].observed_state === 'waiting_for_result')) t.suspended_status = 'queued';
          const units = t.unit_ids.map((uid) => state.work_units[workKey(t.spec.task_id, uid)]);
          t.status = t.result?.status === 'completed' && t.result.validity === 'current' && units.every((u) => u.status === 'completed') ? 'completed' : t.suspended_status || 'queued';
        }
        if (Object.values(state.decisions).some((d) => d.status === 'pending' && d.affected_tasks.includes(t.spec.task_id))) t.status = 'waiting_for_user';
        else if (decisionBlockers(state, t).length) t.status = 'needs_review';
        delete t.suspended_status;
      }
      event.status = 'verified'; return event;
    }
    const desired = request.action === 'pause' ? 'paused' : 'cancelled';
    if (request.target === 'project') state.desired_state = desired;
    for (const t of tasks) {
      if (t.desired_state === 'cancelled') continue;
      if (request.action === 'pause' && t.desired_state !== 'paused') t.suspended_status = t.status;
      t.desired_state = desired;
      const activeIds = t.attempts.filter((aid) => attempts.includes(aid));
      if (activeIds.length) {
        t.status = request.action + '_requested';
        for (const aid of activeIds) {
          const a = state.attempts[aid];
          a.desired_state = desired;
          if (request.action === 'cancel' && a.observed_state === 'waiting_for_result' && a.job_refs.length === 0) {
            a.observed_state = 'cancelled'; a.timestamps.ended_at = now(); settle(state, a, null);
            t.status = 'cancelled';
          }
        }
      } else if (!['completed', 'failed', 'needs_review'].includes(t.status)) t.status = desired;
    }
    event.status = attempts.some((aid) => !terminal(state.attempts[aid])) ? 'applied' : 'verified';
    event.checkpoint_boundary = request.action === 'pause' ? 'end_of_current_work_unit' : null;
    return event;
  });
}
export function requestDecision(store, input) {
  contract('decision', input);
  return store.transaction((state) => {
    requireThat(!Object.hasOwn(state.decisions, input.decision_id), 'Decision already exists');
    if (input.supersedes_decision_id) {
      const previous = state.decisions[input.supersedes_decision_id];
      requireThat(previous?.status === 'answered' && previous.answer === 'decline' &&
        previous.affected_tasks.every((tid) => input.affected_tasks.includes(tid) && previous.task_revisions[tid] === input.task_revisions[tid]),
      'Replacement decision must explicitly cover the declined decision and its revisions');
    }
    for (const tid of input.affected_tasks) {
      const t = taskAt(state, tid);
      requireThat(input.task_revisions[tid] === t.revision, 'Decision revision mismatch');
      requireThat(!t.attempts.some((aid) => ACTIVE.has(state.attempts[aid].observed_state) || state.attempts[aid].observed_state === 'unknown'), 'Pause/reconcile affected running tasks before requesting a decision');
      if (t.desired_state === 'paused') t.suspended_status = 'waiting_for_user';
      else t.status = 'waiting_for_user';
    }
    state.decisions[input.decision_id] = { ...clone(input), status: 'pending', created_at: now() };
    return state.decisions[input.decision_id];
  });
}
export function answerDecision(store, decisionId, answer) {
  requireThat(['approve', 'decline'].includes(answer), 'Answer must be approve or decline');
  return store.transaction((state) => {
    const d = state.decisions[decisionId];
    requireThat(d && d.status === 'pending', 'No pending decision');
    for (const tid of d.affected_tasks) requireThat(taskAt(state, tid).revision === d.task_revisions[tid], 'Decision is stale; request a new decision');
    d.status = 'answered'; d.answer = answer; d.answered_at = now();
    for (const tid of d.affected_tasks) {
      const t = taskAt(state, tid);
      const stillWaiting = Object.values(state.decisions).some((other) => other.status === 'pending' && other.affected_tasks.includes(tid));
      const next = stillWaiting ? 'waiting_for_user' : decisionBlockers(state, t).length ? 'needs_review' : 'queued';
      if (t.desired_state === 'paused') { t.suspended_status = next; if (t.status !== 'needs_review') t.status = 'paused'; }
      else t.status = next;
    }
    return d;
  });
}
export function takeOwnership(store, owner, expectedEpoch) {
  return store.transaction((state) => {
    requireThat(Number(expectedEpoch) === state.owner.epoch, 'Stale ownership epoch');
    requireThat(typeof owner === 'string' && owner.trim(), 'Owner required');
    state.owner = { id: owner, epoch: state.owner.epoch + 1 };
    return state.owner;
  });
}
export function adoptResult(store, attemptId, owner, epoch) {
  return store.transaction((state) => {
    checkOwner(state, owner, epoch);
    const attempt = state.attempts[attemptId];
    requireThat(attempt?.result && terminal(attempt), 'No completed result to adopt');
    const task = taskAt(state, attempt.task_id);
    requireThat(attempt.task_revision === task.revision && attempt.protocol_version === task.spec.protocol_version, 'Result belongs to an older revision');
    requireThat(task.desired_state !== 'cancelled' && evidenceCurrent(state, attempt), 'Result is cancelled or evidence changed');
    const { validity: previousValidity, ...rawResult } = attempt.result;
    validateResult(state, attempt, rawResult);
    requireThat(attempt.result.status === 'completed', 'Only completed results can be adopted');
    for (const dep of task.spec.dependencies) requireThat(currentTaskResult(state, dep), 'Dependency requires review');
    attempt.result.validity = 'current';
    attempt.adopted_by = { owner, epoch: Number(epoch), at: now() };
    requireThat(assignmentCurrent(state, attempt), 'Cannot adopt a superseded worker assignment');
    pinOutputs(state, attempt, attempt.result);
    completeUnit(state, attempt);
    return attempt;
  });
}
export function handoff(state) {
  requireThat([4, 5].includes(state.schema_version), 'Migrate state before creating a handoff');
  const gui = state.gui ? clone(state.gui) : null;
  if (gui) {
    Object.values(gui.attachments).forEach((a) => { delete a.token_hash; });
    Object.values(gui.operations).forEach((op) => { delete op.credential; });
  }
  return contract('handoff', { schema_version: state.schema_version, ...(gui ? { gui } : {}), publication: state.publication || null, publications: clone(state.publications || {}), created_at: now(), project: clone(state.project), owner: clone(state.owner),
    desired_state: state.desired_state, tasks: clone(state.tasks), attempts: clone(state.attempts), decisions: clone(state.decisions),
    authorizations: clone(state.config.autonomy.grants), pending_events: Object.values(state.events).filter((e) => e.status !== 'verified'),
    usage: clone(state.usage), reservations: reservations(state), config_hash: state.config_hash,
    work_units: clone(state.work_units), assignments: clone(state.assignments), checkpoints: clone(state.checkpoints),
    extension_calls: clone(state.extension_calls), extension_usage: clone(state.extension_usage),
    recoveries: clone(state.recoveries), pools: clone(state.pools),
    research: clone(researchState(state)), improvements: clone(state.improvements || {}), benchmarks: clone(state.benchmarks || {}),
    next_actions: Object.values(state.tasks).filter((t) => t.status !== 'completed').map((t) => t.spec.task_id + ': ' + t.status) });
}
export function reconcile(store, observations = []) {
  return store.transaction((state) => {
    for (const observation of observations) {
      const attempt = state.attempts[observation.attempt_id];
      requireThat(attempt && attempt.observed_state === 'unknown', 'Explicit observations only resolve unknown attempts');
      requireThat(observation.evidence && observation.evidence.length > 0, 'Reconciliation needs evidence artifact(s)');
      observation.evidence.forEach((ref) => artifactCheck(state.project.workspace, ref));
      if (attempt.job_refs.some((job) => job.child_coverage === 'unverified' || job.descendants_state === 'unknown')) {
        requireThat(observation.descendants_verified === true, 'Reconciliation must explicitly verify untracked descendants, not only the parent process');
      }
      requireThat(['cancelled', 'failed'].includes(observation.status), 'Use import-result for completed output');
      attempt.observed_state = observation.status;
      attempt.job_refs = attempt.job_refs.map((job) => job.kind === 'external' ? job : {
        ...job, observed_state: 'exited', descendants_state: 'verified_terminal', reconciled_at: now()
      });
      attempt.reconciliation = { at: now(), evidence: clone(observation.evidence) };
      if (assignmentCurrent(state, attempt)) {
        state.tasks[attempt.task_id].status = observation.status;
        state.work_units[workKey(attempt.task_id, attempt.work_unit_id)].status = observation.status;
      }
      state.assignments[attempt.assignment_id].status = 'ended';
      if (observation.failure_code) attempt.failure = classifyFailure({ code: observation.failure_code, message: 'Operator-reconciled failure' });
      settle(state, attempt, null);
    }
    for (const attempt of Object.values(state.attempts)) {
      if (!ACTIVE.has(attempt.observed_state) || attempt.observed_state === 'waiting_for_result') continue;
      let alive = true;
      try { process.kill(attempt.runner_pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
      // A PID being alive is not proof of identity. Never signal a PID after reconnect.
      const expired = Date.parse(state.assignments[attempt.assignment_id].lease_expires_at) < Date.now();
      if (!alive || expired) {
        attempt.observed_state = 'unknown';
        attempt.error = 'Runner absent; external job state must be verified';
        state.tasks[attempt.task_id].status = 'unknown';
        state.work_units[workKey(attempt.task_id, attempt.work_unit_id)].status = 'unknown';
        state.assignments[attempt.assignment_id].status = 'unknown';
      }
    }
    refreshControlEvents(state);
    return { attempts: clone(state.attempts), reservations: reservations(state) };
  });
}
export function registerJob(store, attemptId, job) {
  requireThat(typeof job.job_id === 'string' && job.job_id && job.kind === 'external', 'External job identity is required');
  return store.transaction((state) => {
    const attempt = state.attempts[attemptId];
    requireThat(attempt && assignmentCurrent(state, attempt) && ACTIVE.has(attempt.observed_state), 'No current running assignment');
    requireThat(!Object.values(state.attempts).some((a) => a.job_refs.some((j) => j.job_id === job.job_id)), 'Job is already registered');
    attempt.job_refs.push({ job_id: job.job_id, kind: 'external', owner_attempt: attemptId,
      observed_state: 'running', handle: clone(job.handle || {}), cancellation_supported: false });
    return attempt.job_refs.at(-1);
  });
}
export function observeJob(store, attemptId, jobId, observation) {
  return store.transaction((state) => {
    const a = state.attempts[attemptId], job = a?.job_refs.find((j) => j.job_id === jobId && ['external', 'extension'].includes(j.kind));
    requireThat(job, 'Unknown registered external job');
    requireThat(['running', 'completed', 'failed', 'cancelled', 'unknown'].includes(observation.status), 'Invalid external job state');
    requireThat(observation.evidence?.length, 'Job observation requires evidence');
    observation.evidence.forEach((ref) => artifactCheck(state.project.workspace, ref));
    job.observed_state = observation.status; job.observed_at = now(); job.evidence = clone(observation.evidence);
    if (!a.settled && terminal(a)) {
      settle(state, a, a.result?.usage || a.native_usage || a.telemetry?.totals || null);
      benchmarkFinished(state, a);
    }
    refreshControlEvents(state);
    const task = state.tasks[a.task_id];
    if (task.status === 'cancel_requested' && task.attempts.every((aid) => terminal(state.attempts[aid]))) {
      task.status = task.result?.validity === 'current' ? 'completed' : 'cancelled';
    }
    return job;
  });
}
export function recordRun(store, run) {
  contract('run', run);
  return store.transaction((state) => {
    requireThat(!Object.hasOwn(state.runs, run.run_id), 'Run ID is immutable');
    const attempt = state.attempts[run.attempt_id];
    requireThat(attempt && attempt.protocol_version === run.protocol_version, 'Run attempt/protocol mismatch');
    run.outputs.forEach((ref) => artifactCheck(state.project.workspace, ref));
    state.runs[run.run_id] = clone(run);
    return run;
  });
}
export function recordClaim(store, claim) {
  contract('claim', claim);
  return store.transaction((state) => {
    requireThat(!Object.hasOwn(state.claims, claim.claim_id), 'Claim record is immutable; use a new ID for revision');
    requireThat(claim.evaluation_status !== 'supported' || claim.supporting.length, 'Supported claim needs evidence');
    requireThat(claim.evaluation_status !== 'contradicted' || claim.contradicting.length, 'Contradicted claim needs counterevidence');
    [...claim.supporting, ...claim.contradicting].forEach((ref) => artifactCheck(state.project.workspace, ref));
    state.claims[claim.claim_id] = clone(claim);
    return claim;
  });
}
