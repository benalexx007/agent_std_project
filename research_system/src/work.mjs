import { clone, requireThat } from './util.mjs';

export const workKey = (taskId, unitId) => taskId + '/' + unitId;
export function unitSpecs(task) {
  if (task.work_units) return task.work_units;
  const headroom = Math.min(256, Math.ceil(task.budget.reservation_tokens * 0.1));
  return [{ work_unit_id: 'main', objective: task.objective, dependencies: [],
    expected_artifacts: task.expected_artifacts, estimate: {
      work_tokens: task.budget.reservation_tokens - headroom, validation_tokens: 0,
      checkpoint_tokens: Math.ceil(headroom / 2), margin_tokens: Math.floor(headroom / 2),
      cost_usd: task.budget.reservation_cost_usd, context_growth_tokens: 0
    } }];
}
export function installUnits(state, task) {
  const specs = unitSpecs(task);
  const names = new Set();
  for (const spec of specs) {
    requireThat(!names.has(spec.work_unit_id), 'Duplicate work unit');
    requireThat(spec.dependencies.every((d) => names.has(d)), 'Work units must be in dependency order');
    names.add(spec.work_unit_id);
    state.work_units[workKey(task.task_id, spec.work_unit_id)] = {
      task_id: task.task_id, task_revision: task.task_revision, spec: clone(spec), status: 'queued',
      generation: 0, assignment_id: null, attempts: [], checkpoint_id: null, transfers: 0, retries: 0, yields: 0
    };
  }
  state.tasks[task.task_id].unit_ids = specs.map((u) => u.work_unit_id);
}
export function getUnit(state, taskId, unitId) {
  const t = state.tasks[taskId];
  requireThat(Object.hasOwn(state.tasks, taskId), 'Unknown task');
  const key = unitId ? workKey(taskId, unitId) :
    t.unit_ids.map((uid) => workKey(taskId, uid)).find((k) => state.work_units[k].status !== 'completed');
  const unit = state.work_units[key];
  requireThat(unit, 'No remaining work unit');
  requireThat(unit.task_revision === t.revision, 'Work unit revision mismatch');
  requireThat(unit.spec.dependencies.every((d) => state.work_units[workKey(taskId, d)]?.status === 'completed'), 'Work unit dependencies are not completed');
  return unit;
}
export function assignmentCurrent(state, attempt) {
  if (!attempt.assignment_id) return false;
  const unit = state.work_units[workKey(attempt.task_id, attempt.work_unit_id)];
  return unit && unit.generation === attempt.assignment_generation && unit.assignment_id === attempt.assignment_id;
}
export const publicationOrder = (units) => [...units].sort((a, b) => (a.publication_sequence || 0) - (b.publication_sequence || 0));
export function completeUnit(state, attempt) {
  const task = state.tasks[attempt.task_id];
  const unit = state.work_units[workKey(attempt.task_id, attempt.work_unit_id)];
  unit.status = 'completed'; unit.result = clone(attempt.result);
  unit.publication_sequence = task.publication_sequence = (task.publication_sequence || 0) + 1;
  const units = task.unit_ids.map((uid) => state.work_units[workKey(attempt.task_id, uid)]);
  if (!units.every((u) => u.status === 'completed')) {
    task.status = task.desired_state === 'paused' ? 'paused' : 'queued';
    delete task.result;
    return false;
  }
  const records = publicationOrder(units).map((u) => u.result);
  const unique = (key) => [...new Map(records.flatMap((r) => r[key]).map((r) => [r.path, r])).values()];
  task.result = { ...clone(attempt.result), artifacts: unique('artifacts'), evidence_refs: unique('evidence_refs'),
    checks: records.flatMap((r) => r.checks), limitations: [...new Set(records.flatMap((r) => r.limitations))],
    unresolved: [...new Set(records.flatMap((r) => r.unresolved))] };
  requireThat(task.spec.expected_artifacts.every((p) => task.result.artifacts.some((r) => r.path === p)), 'Task is missing expected artifacts');
  task.status = task.desired_state === 'paused' ? 'paused' : 'completed';
  return true;
}
