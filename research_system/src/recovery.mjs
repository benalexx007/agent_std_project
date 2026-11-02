import { id, now, clone, requireThat, hash } from './util.mjs';
import { getUnit, workKey } from './work.mjs';
import { poolIds, budgetAdmission } from './resources.mjs';
import { capabilities } from '../adapters/index.mjs';
import { buildContext } from './context.mjs';
import { usableCheckpoint } from './checkpoints.mjs';
import { modelForBackend } from './models.mjs';

export function planRecovery(store, taskId, owner, epoch, unitId) {
  return store.transaction((state) => {
    requireThat(state.owner.id === owner && state.owner.epoch === Number(epoch), 'Stale orchestration owner');
    const task = state.tasks[taskId]; requireThat(task, 'Unknown task');
    const unit = getUnit(state, taskId, unitId);
    const last = state.attempts[unit.attempts.at(-1)];
    requireThat(last, 'No attempt to recover');
    const policy = state.config.recovery_policy;
    const report = { recovery_id: id('recovery'), task_id: taskId, work_unit_id: unit.spec.work_unit_id,
      source_attempt_id: last.attempt_id, source_generation: unit.generation, created_at: now(),
      status: 'blocked', candidates: [], checkpoint_id: unit.checkpoint_id, reason: null };
    const block = (reason, status = 'blocked') => {
      report.reason = reason; report.status = status;
      state.recoveries[report.recovery_id] = report;
      if (status === 'waiting_for_capacity') { task.status = status; unit.status = status; }
      return report;
    };
    if (state.desired_state !== 'running' || task.desired_state !== 'running') return block('User pause/cancel takes precedence');
    if (last.job_refs.some((job) => job.kind === 'external' && !['completed', 'cancelled', 'failed'].includes(job.observed_state))) return block('Owned external jobs still running; monitor/reconcile them, do not relaunch');
    if (!last.settled || ['dispatching', 'running', 'unknown', 'waiting_for_result'].includes(last.observed_state)) return block('Reconcile active/unknown attempt and side effects first');
    if (Object.values(state.decisions).some((d) => d.status === 'pending' && d.affected_tasks.includes(taskId))) return block('Waiting for user decision');
    requireThat(task.status !== 'needs_review', 'Reopen task after review before preparing recovery');
    if (!last.failure?.recoverable && last.observed_state !== 'yielded') return block('Failure is not eligible for automatic fallback');
    if (unit.attempts.length >= policy.max_segments_per_unit || task.attempts.length >= task.spec.budget.max_attempts) return block('Recovery segment/attempt budget exhausted');
    if (last.job_refs.some((job) => !['exited', 'completed', 'cancelled', 'failed'].includes(job.observed_state))) return block('Owned external jobs still running; monitor/reconcile them, do not relaunch');
    let checkpoint = null;
    if (unit.checkpoint_id) {
      const selected = usableCheckpoint(state, taskId, unit.spec.work_unit_id);
      checkpoint = selected.manifest;
      report.rejected_checkpoints = selected.rejected;
      report.checkpoint_id = checkpoint?.checkpoint_id || null;
      if (!checkpoint) return block('No reusable durable checkpoint: changed artifacts or bundle');
    }
    if (task.spec.writes_workspace && !checkpoint) return block('Writer recovery requires a verified checkpoint/diff');
    report.progress_fingerprint = hash(JSON.stringify(checkpoint ? {
      completed_units: checkpoint.completed_units, summary: checkpoint.summary,
      remaining_actions: checkpoint.remaining_actions, artifacts: checkpoint.artifacts, checks: checkpoint.checks
    } : { completed_units: task.unit_ids.filter((uid) => state.work_units[workKey(taskId, uid)].status === 'completed') }));
    const noProgress = unit.progress_fingerprint === report.progress_fingerprint ? (unit.no_progress_recoveries || 0) + 1 : 0;
    if (noProgress >= policy.max_no_progress_recoveries) return block('No new checkpoint evidence/progress; bounded recovery stopped', 'waiting_for_capacity');
    const candidates = [last.backend, ...policy.candidates].filter((v, i, all) => all.indexOf(v) === i);
    const exhausted = ['quota_exhausted', 'rate_limit'].includes(last.failure?.reason);
    const originalPools = poolIds(state.config, last.backend);
    for (const backendName of candidates) {
      const backend = state.config.backends[backendName];
      if (!backend) continue;
      let rejected = null;
      if (!backend.allow_execute && backend.kind !== 'manual') rejected = 'Backend execution is disabled';
      if (!['mock', 'manual'].includes(backend.kind) && !state.config.execution.allow_external) rejected = 'External execution is disabled';
      if (task.spec.capabilities.some((cap) => capabilities(backend)[cap] !== true)) rejected = 'Missing required capability';
      if (backendName !== last.backend && unit.transfers >= policy.max_transfers) rejected = 'Transfer limit reached';
      if (backendName === last.backend && last.observed_state !== 'yielded' && unit.retries >= policy.max_same_backend_retries) rejected = 'Same-backend retry limit reached';
      const targetPools = poolIds(state.config, backendName);
      const stillExhausted = (pid) => {
        const pool = state.pools[pid], snapshot = pool.snapshot;
        return !snapshot || snapshot.remaining_tokens === null || snapshot.remaining_tokens <= pool.definition.reserve_tokens ||
          Date.parse(snapshot.observed_at) < Date.parse(last.timestamps.ended_at) ||
          Date.now() - Date.parse(snapshot.observed_at) > pool.definition.max_snapshot_age_ms;
      };
      if (exhausted && originalPools.some((pid) => targetPools.includes(pid) && stillExhausted(pid))) rejected = 'Target shares the exhausted/rate-limited pool';
      if (exhausted && (!originalPools.length || !targetPools.length)) rejected = 'Pool independence is unknown';
      let effective;
      try { effective = modelForBackend(state.config, task.spec, backendName); }
      catch (error) {
        report.candidates.push({ backend: backendName, allowed: false, reason: error.message });
        continue;
      }
      let context;
      try { context = buildContext(state.config, effective, Object.values(state.decisions), task.notes || [], state); }
      catch (error) { report.candidates.push({ backend: backendName, allowed: false, reason: error.message }); continue; }
      context.characters += checkpoint ? JSON.stringify(checkpoint).length : 0;
      const admission = budgetAdmission(state, { ...task, spec: effective }, unit, backendName, context, true);
      if (!admission.allowed) rejected = admission.message;
      report.candidates.push({ backend: backendName, allowed: !rejected, reason: rejected, admission });
      if (!rejected) {
        report.status = 'ready'; report.target_backend = backendName;
        report.checkpoint_id = checkpoint?.checkpoint_id || null; report.reason = 'Continue remaining work from durable artifacts';
        break;
      }
    }
    state.recoveries[report.recovery_id] = report;
    if (report.status !== 'ready') { task.status = 'waiting_for_capacity'; unit.status = 'waiting_for_capacity'; report.status = 'waiting_for_capacity'; }
    return clone(report);
  });
}
