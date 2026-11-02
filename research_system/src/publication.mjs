import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { clone, id, now, confined, requireThat, fileHash, writeJSON } from './util.mjs';
import { pinFile, copyFileDurable } from './blobs.mjs';
import { workspacePath, workspaceManifest, isolated, currentHash, publicationPending } from './workspaces.mjs';
import { assignmentCurrent } from './work.mjs';
import { finishAttempt, validateResult, hasLiveJobs, currentTaskResult, checkOwner } from './engine.mjs';

import { extensionArtifacts } from './extension-runner.mjs';

function guard(s, attempt) {
  requireThat(attempt && !attempt.settled && assignmentCurrent(s, attempt) && attempt.owner_epoch === s.owner.epoch &&
    attempt.task_revision === s.tasks[attempt.task_id].revision, 'Stale assignment cannot publish');
  requireThat(!hasLiveJobs(attempt), 'Resolve descendant jobs before publication');
  requireThat(s.tasks[attempt.task_id].spec.dependencies.every((d) => currentTaskResult(s, d)), 'Publication dependency changed');
  for (const ref of attempt.input_refs) requireThat(currentHash(s.project.workspace, ref.path) === ref.sha256, 'Publication input changed: ' + ref.path);
}
function verifiedBlob(s, ref) {
  const file = confined(s.project.workspace, ref.blob);
  requireThat(fileHash(file) === ref.sha256, 'Publication snapshot changed: ' + ref.path);
  return file;
}

// No model invocation. Large copies and hashing run before acquiring the publication lock.
export async function completeAttempt(store, attemptId, outcome, hooks = {}) {
  const initial = store.read(), a = initial.attempts[attemptId];
  if (!isolated(a) || !outcome.result || outcome.result.status !== 'completed') return finishAttempt(store, attemptId, outcome);
  if (a.settled) return finishAttempt(store, attemptId, outcome);
  requireThat(!publicationPending(initial), 'Recover pending publication before accepting another result');
  guard(initial, a);
  const result = clone(outcome.result);
  validateResult(initial, a, result);
  const baseline = workspaceManifest(initial, a);
  const allowed = new Map(baseline.outputs.map((r) => [r.path, r]));
  for (const ref of extensionArtifacts(initial, a)) {
    requireThat(ref.path.startsWith('research-artifacts/extension_'), 'Invalid helper publication namespace');
    requireThat(fileHash(workspacePath(a.workspace.root, ref.path)) === ref.sha256, 'Helper output changed');
    allowed.set(ref.path, { path: ref.path, sha256: null, blob: null });
  }
  const outputs = [], root = initial.project.workspace, journalId = id('publication');
  let bytes = 0;
  try {
  for (const ref of result.artifacts) {
    requireThat(allowed.has(ref.path), 'Isolated output is not declared: ' + ref.path);
    const blob = await pinFile(root, workspacePath(a.workspace.root, ref.path), ref.sha256,
      initial.config.workspace_policy.max_bytes - bytes);
    bytes += blob.bytes;
    const target = workspacePath(root, ref.path, false);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = path.join(path.dirname(target), '.agentic-publish-' + journalId + '-' + outputs.length);
    outputs.push({ path: ref.path, sha256: ref.sha256, blob: blob.path,
      baseline: allowed.get(ref.path), temp: path.relative(root, temp).split(path.sep).join('/') });
    await pipeline(fs.createReadStream(confined(root, blob.path)), fs.createWriteStream(temp, { flags: 'wx' }));
    const fd = fs.openSync(temp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  const outputPaths = new Set(outputs.map((r) => r.path));
  for (const ref of result.evidence_refs) {
    if (outputPaths.has(ref.path)) continue;
    requireThat(baseline.files.some((r) => r.path === ref.path && r.sha256 === ref.sha256) &&
      currentHash(root, ref.path) === ref.sha256, 'Generated evidence must be a declared artifact: ' + ref.path);
  }
  // This durable candidate is useful even if admission/base comparison fails; it is not accepted output.
  writeJSON(confined(root, '.agentic/attempts/' + attemptId + '/publication-candidate.json', false), { outcome: { ...outcome, result }, outputs });
  store.transaction((s) => {
    guard(s, s.attempts[attemptId]);
    requireThat(!publicationPending(s), 'Another publication is pending');
    for (const r of outputs) requireThat(currentHash(root, r.path) === r.baseline.sha256, 'Publication conflict: ' + r.path);
    s.publications[journalId] = { publication_id: journalId, attempt_id: attemptId, owner_epoch: a.owner_epoch,
      status: 'pending', phase: 'prepared', created_at: now(), outputs, outcome: { ...clone(outcome), result } };
    s.publication = journalId;
    s.attempts[attemptId].publication_id = journalId;
  });
  hooks.afterIntent?.(journalId);
  installPublication(store, journalId, hooks);
  return finishAttempt(store, attemptId, { ...outcome, result });
  } finally {
    if (store.read().publications?.[journalId]?.status !== 'pending') {
      for (const r of outputs) {
        const file = confined(root, r.temp, false);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
  }
}

function installPublication(store, journalId, hooks = {}) {
  store.transaction((s) => {
    const j = s.publications[journalId], a = s.attempts[j.attempt_id], root = s.project.workspace;
    requireThat(j.status === 'pending' && s.publication === journalId, 'Publication is not pending');
    guard(s, a);
    // Validate the entire set before touching any public path, including recovery after partial rename.
    for (const r of j.outputs) {
      requireThat([r.baseline.sha256, r.sha256].includes(currentHash(root, r.path)), 'Publication conflict: ' + r.path);
      verifiedBlob(s, r);
    }
    for (const [index, r] of j.outputs.entries()) {
      if (currentHash(root, r.path) === r.sha256) continue;
      const target = workspacePath(root, r.path, false), temp = confined(root, r.temp, false);
      if (!fs.existsSync(temp)) copyFileDurable(verifiedBlob(s, r), temp);
      requireThat(fileHash(temp) === r.sha256, 'Publication temporary bytes changed');
      fs.renameSync(temp, target);
      hooks.afterInstall?.(index);
    }
    j.phase = 'files_installed';
  });
}

export function recoverPublication(store, owner, epoch, action = 'complete') {
  const s = store.read(); checkOwner(s, owner, epoch);
  requireThat(publicationPending(s), 'No pending publication');
  const j = s.publications[s.publication];
  requireThat(['complete', 'rollback'].includes(action), 'Expected complete or rollback');
  if (action === 'complete') {
    installPublication(store, j.publication_id);
    return finishAttempt(store, j.attempt_id, j.outcome);
  }
  // Restore by bytes, not by re-running the worker. Do not overwrite third-party changes.
  store.transaction((next) => {
    checkOwner(next, owner, epoch);
    const current = next.publications[j.publication_id], root = next.project.workspace;
    requireThat(next.publication === j.publication_id && current.status === 'pending', 'Publication changed');
    for (const r of current.outputs) {
      requireThat([r.sha256, r.baseline.sha256].includes(currentHash(root, r.path)), 'Rollback conflict: ' + r.path);
      if (r.baseline.sha256) verifiedBlob(next, r.baseline);
    }
    for (const r of current.outputs) {
      if (currentHash(root, r.path) === r.baseline.sha256) continue;
      const target = workspacePath(root, r.path, false);
      if (!r.baseline.sha256) fs.unlinkSync(target);
      else {
        const temp = target + '.agentic-rollback-' + j.publication_id;
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
        copyFileDurable(verifiedBlob(next, r.baseline), temp);
        fs.renameSync(temp, target);
      }
    }
    current.status = 'rolled_back'; current.ended_at = now(); next.publication = null;
    const a = next.attempts[j.attempt_id];
    if (!a.settled) {
      a.observed_state = 'unknown'; a.error = 'Publication rolled back; reconcile executor/jobs before retry';
      next.tasks[a.task_id].status = 'unknown';
      next.work_units[a.task_id + '/' + a.work_unit_id].status = 'unknown';
      next.assignments[a.assignment_id].status = 'unknown';
    }
  });
  return { publication_id: j.publication_id, status: 'rolled_back', reservation_released: false };
}
