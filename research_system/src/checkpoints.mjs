import fs from 'node:fs';
import { executionRoot, isolated } from './workspaces.mjs';
import { pinRefs } from './receipts.mjs';
import path from 'node:path';
import { now, id, clone, requireThat, hash, artifactCheck, confined } from './util.mjs';
import { assignmentCurrent, workKey } from './work.mjs';
import { contract } from './schema.mjs';
import { researchSnapshot, checkResearchSnapshot } from './research.mjs';
import { bundleResource } from './improvements.mjs';
import { projectDomain } from './domains.mjs';

export function loadCheckpoint(state, checkpointId) {
  projectDomain(state);
  const record = state.checkpoints[checkpointId];
  requireThat(record?.durable_at, 'No durable checkpoint');
  const file = confined(state.project.workspace, record.manifest_path);
  const text = fs.readFileSync(file, 'utf8');
  requireThat(hash(text) === record.manifest_sha256, 'Checkpoint manifest changed');
  const manifest = JSON.parse(text);
  requireThat(manifest.task_revision === state.tasks[manifest.task_id].revision &&
    manifest.protocol_version === state.tasks[manifest.task_id].spec.protocol_version, 'Stale checkpoint revision/protocol');
  for (const ref of [...manifest.artifacts, ...manifest.input_refs]) artifactCheck(state.project.workspace, ref);
  for (const ref of manifest.bundle_refs || []) {
    artifactCheck(ref.root === 'workspace' ? state.project.workspace : state.config.bundle_root, ref);
    requireThat(bundleResource(state.config, state, ref.target || ref.path).ref.sha256 === ref.sha256, 'Checkpoint bundle policy changed');
  }
  checkResearchSnapshot(state, manifest.research_refs);
  return manifest;
}
export function usableCheckpoint(state, taskId, unitId) {
  const rejected = [];
  const candidates = Object.values(state.checkpoints).filter((c) => c.task_id === taskId && c.work_unit_id === unitId)
    .sort((a, b) => b.sequence - a.sequence);
  for (const record of candidates) {
    try { return { manifest: loadCheckpoint(state, record.checkpoint_id), rejected }; }
    catch (error) { rejected.push({ checkpoint_id: record.checkpoint_id, reason: error.message }); }
  }
  return { manifest: null, rejected };
}
export function saveCheckpoint(store, attemptId, progress, afterWrite) {
  return persistCheckpoint(store, attemptId, progress, afterWrite, false);
}
// Boundary checkpoint derives its payload from the already-validated result; workers cannot supply it.
export function saveFinalCheckpoint(store, attemptId) {
  return persistCheckpoint(store, attemptId, null, null, true);
}
function persistCheckpoint(store, attemptId, progress, afterWrite, final) {
  if (!final) contract('checkpoint-progress', progress);
  return store.transaction((state) => {
    projectDomain(state);
    const a = state.attempts[attemptId]; requireThat(a && assignmentCurrent(state, a), 'Stale assignment cannot checkpoint');
    const task = state.tasks[a.task_id], unit = state.work_units[workKey(a.task_id, a.work_unit_id)];
    if (final) {
      requireThat(a.settled && a.observed_state === 'completed' && a.result?.status === 'completed' && a.result.validity === 'current' && unit.status === 'completed',
        'Final checkpoint requires a current validated completed result');
      requireThat(!a.final_checkpoint_id, 'Final result is already checkpointed');
      progress = { summary: a.result.summary, remaining_actions: [], artifacts: a.result.artifacts, checks: a.result.checks, uncertainties: a.result.unresolved };
    } else requireThat(!a.settled && ['dispatching', 'running', 'waiting_for_result', 'yielding', 'pause_requested'].includes(a.observed_state) &&
      a.desired_state !== 'cancelled', 'Inactive or unknown attempt cannot checkpoint');
    requireThat(a.owner_epoch === state.owner.epoch && a.task_revision === task.revision, 'Stale owner or revision cannot checkpoint');
    const root = final ? state.project.workspace : executionRoot(state, a);
    [...progress.artifacts, ...(a.input_refs || [])].forEach((r) => artifactCheck(root, r));
    const bindings = isolated(a) ? pinRefs(state.project.workspace, root, progress.artifacts, state.config.workspace_policy.max_bytes) : [];
    if (isolated(a)) progress = { ...clone(progress), artifacts: bindings.map((r) => ({ path: r.path, sha256: r.sha256 })) };
    const checkpointId = id('checkpoint');
    const manifest = {
      checkpoint_id: checkpointId, sequence: (unit.checkpoint_sequence || 0) + 1,
      task_id: a.task_id, task_revision: a.task_revision, work_unit_id: a.work_unit_id,
      attempt_id: a.attempt_id, assignment_generation: a.assignment_generation, protocol_version: a.protocol_version,
      role: task.spec.role, skills: task.spec.skills, config_hash: a.config_hash,
      research_refs: researchSnapshot(state, task.spec),
      bundle_refs: a.bundle_refs || [state.config.roles[task.spec.role].profile,
        ...task.spec.skills.map((skill) => path.join(state.config.skills[skill], 'SKILL.md')),
        'domains/research/rubrics/' + task.spec.study_type + '.md'].map((ref) => ({
          path: ref, sha256: hash(fs.readFileSync(confined(state.config.bundle_root, ref)))
        })),
      completed_units: task.unit_ids.filter((uid) => state.work_units[workKey(a.task_id, uid)].status === 'completed'),
      remaining_units: task.unit_ids.filter((uid) => state.work_units[workKey(a.task_id, uid)].status !== 'completed'),
      ...clone(progress), ...(bindings.length ? { artifact_bindings: bindings.map((r) => ({ path: r.logical_path, sha256: r.sha256, snapshot: r.path })) } : {}), input_refs: clone(a.input_refs || []), jobs: clone(a.job_refs),
      decisions: clone(state.decisions), authorizations: clone(state.config.autonomy.grants), usage: clone(state.usage),
      context_hash: a.context_hash, durable_at: now(), trust: 'artifact_hashes_checked_not_scientifically_verified'
    };
    const relative = path.join('.agentic', 'checkpoints', checkpointId + '.json');
    const absolute = path.join(state.project.workspace, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const temporary = absolute + '.tmp';
    const text = JSON.stringify(manifest, null, 2) + '\n';
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, absolute);
    // Publishing into SQLite comes last. Orphan manifests are never selected for recovery.
    if (afterWrite) afterWrite(manifest);
    const record = { checkpoint_id: checkpointId, task_id: a.task_id, work_unit_id: a.work_unit_id,
      sequence: manifest.sequence, manifest_path: relative, manifest_sha256: hash(text), durable_at: manifest.durable_at };
    state.checkpoints[checkpointId] = record;
    unit.checkpoint_id = checkpointId; unit.checkpoint_sequence = manifest.sequence;
    a.checkpoint_id = checkpointId;
    if (final) a.final_checkpoint_id = checkpointId;
    return record;
  });
}
