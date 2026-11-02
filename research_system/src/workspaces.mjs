import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { confined, requireThat, now, hash, fileHash, writeJSON } from './util.mjs';
import { pinFile } from './blobs.mjs';
import { assignmentCurrent, unitSpecs } from './work.mjs';

export const executionRoot = (state, attempt) => attempt?.workspace?.root || state.project.workspace;
export const isolated = (attempt) => attempt?.workspace?.mode === 'snapshot_directory';
export const publicationPending = (state) => Boolean(state.publication && state.publications?.[state.publication]?.status === 'pending');

export function workspacePath(root, relative, mustExist = true) {
  requireThat(typeof relative === 'string' && relative.length && !path.isAbsolute(relative) &&
    !relative.includes(':') && !relative.includes('\\') && relative.split('/').every((s) => s && s !== '.' && s !== '..' &&
      !/[<>:"|?*\x00-\x1f]/.test(s) && !/[.\s]$/.test(s) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s) &&
      s.toLowerCase() !== '.agentic' && s.toLowerCase() !== '.git' && !s.toLowerCase().startsWith('.agentic-publish-')),
    'Invalid execution artifact path: ' + relative);
  const file = confined(root, relative, mustExist);
  let ancestor = file;
  while (ancestor !== path.resolve(root)) {
    if (fs.existsSync(ancestor)) requireThat(!fs.lstatSync(ancestor).isSymbolicLink(), 'Execution symlink/junction is not allowed');
    ancestor = path.dirname(ancestor);
  }
  return file;
}

export function reserveWorkspace(state, attempt) {
  const policy = state.config.workspace_policy;
  if (!policy || policy.mode === 'shared_serial') return;
  requireThat([4, 5].includes(state.schema_version), 'Migrate state before isolated execution');
  const root = confined(state.project.workspace, '.agentic/workspaces/' + attempt.attempt_id, false);
  attempt.workspace = { workspace_id: attempt.attempt_id, mode: policy.mode, root, control_root: state.project.workspace,
    status: 'reserved', created_at: now() };
}

export async function prepareWorkspace(store, attemptId) {
  const state = store.read(), a = state.attempts[attemptId];
  if (!a.workspace) return;
  requireThat(!publicationPending(state) && a.workspace.status === 'reserved', 'Workspace is not preparable');
  const root = state.project.workspace, task = state.tasks[a.task_id].spec, policy = state.config.workspace_policy;
  const selected = new Set(), visiting = new Set();
  const add = (relative) => {
    const source = workspacePath(root, relative), stat = fs.lstatSync(source);
    requireThat(!stat.isSymbolicLink(), 'Snapshot symlinks/junctions require an explicit provider: ' + relative);
    if (stat.isDirectory()) {
      requireThat(!visiting.has(source), 'Workspace directory cycle'); visiting.add(source);
      for (const entry of fs.readdirSync(source).sort()) add(relative + '/' + entry);
      visiting.delete(source);
    } else {
      requireThat(stat.isFile(), 'Workspace input is not a regular file');
      selected.add(relative);
      requireThat(selected.size <= policy.max_files, 'Workspace exceeds max_files');
    }
  };
  for (const p of [...policy.include, ...a.input_refs.map((r) => r.path)]) add(p);
  for (const dep of task.dependencies) for (const r of state.tasks[dep].result.artifacts) add(r.path);
  const expected = [...new Set([...task.expected_artifacts, ...unitSpecs(task).flatMap((u) => u.expected_artifacts)])];
  requireThat(expected.length <= policy.max_files, 'Expected artifacts exceed workspace max_files');
  for (const p of expected) if (fs.existsSync(workspacePath(root, p, false))) add(p);
  const execution = a.workspace.root;
  requireThat(!fs.existsSync(execution), 'Workspace identity already materialized');
  fs.mkdirSync(execution, { recursive: true });
  const files = [], outputs = [], checkpointFiles = [];
  let bytes = 0;
  for (const relative of [...selected].sort()) {
    const source = workspacePath(root, relative);
    requireThat(bytes + fs.statSync(source).size <= policy.max_bytes, 'Workspace exceeds max_bytes');
    const blob = await pinFile(root, source, a.input_refs.find((r) => r.path === relative)?.sha256, policy.max_bytes - bytes);
    bytes += blob.bytes;
    const target = workspacePath(execution, relative, false);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await pipeline(fs.createReadStream(confined(root, blob.path)), fs.createWriteStream(target, { flags: 'wx' }));
    files.push({ path: relative, sha256: blob.sha256, blob: blob.path });
  }
  for (const relative of expected) {
    const source = workspacePath(root, relative, false);
    const blob = fs.existsSync(source) ? await pinFile(root, source) : null;
    outputs.push({ path: relative, sha256: blob?.sha256 || null, blob: blob?.path || null });
  }
  if (a.resumed_from_checkpoint) {
    const record = state.checkpoints[a.resumed_from_checkpoint];
    const text = fs.readFileSync(confined(root, record.manifest_path), 'utf8');
    requireThat(hash(text) === record.manifest_sha256, 'Checkpoint manifest changed');
    for (const ref of JSON.parse(text).artifact_bindings || []) {
      requireThat(!a.input_refs.some((r) => r.path === ref.path), 'Checkpoint cannot overwrite primary input');
      const source = confined(root, ref.snapshot);
      requireThat(fileHash(source) === ref.sha256, 'Checkpoint artifact changed');
      const target = workspacePath(execution, ref.path, false);
      bytes += fs.statSync(source).size - (fs.existsSync(target) ? fs.statSync(target).size : 0);
      const count = new Set([...files.map((r) => r.path), ...checkpointFiles.map((r) => r.path), ref.path]).size;
      requireThat(bytes <= policy.max_bytes && count <= policy.max_files, 'Checkpoint materialization exceeds workspace budget');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await pipeline(fs.createReadStream(source), fs.createWriteStream(target));
      requireThat(fileHash(target) === ref.sha256, 'Checkpoint changed during materialization');
      checkpointFiles.push(ref);
    }
  }
  const manifest = { workspace_id: a.attempt_id, mode: a.workspace.mode, files, outputs, checkpoint_files: checkpointFiles, bytes };
  const manifestPath = '.agentic/attempts/' + a.attempt_id + '/workspace.json';
  writeJSON(confined(root, manifestPath, false), manifest);
  store.transaction((s) => {
    const current = s.attempts[attemptId];
    requireThat(assignmentCurrent(s, current) && current.owner_epoch === s.owner.epoch && !current.settled &&
      current.desired_state === 'running' && s.desired_state === 'running' && s.tasks[a.task_id].desired_state === 'running' &&
      !publicationPending(s), 'Workspace assignment changed during preparation');
    for (const ref of files) requireThat(fileHash(workspacePath(root, ref.path)) === ref.sha256, 'Workspace baseline changed: ' + ref.path);
    for (const ref of outputs) requireThat(currentHash(root, ref.path) === ref.sha256, 'Output baseline changed: ' + ref.path);
    Object.assign(current.workspace, { status: 'ready', manifest_path: manifestPath, manifest_sha256: hash(JSON.stringify(manifest, null, 2) + '\n'), bytes });
  });
}

export function workspaceManifest(state, attempt) {
  requireThat(attempt.workspace?.status === 'ready', 'Workspace is not ready');
  const text = fs.readFileSync(confined(state.project.workspace, attempt.workspace.manifest_path), 'utf8');
  requireThat(hash(text) === attempt.workspace.manifest_sha256, 'Workspace manifest changed');
  return JSON.parse(text);
}
export function currentHash(root, relative) {
  const file = workspacePath(root, relative, false);
  return fs.existsSync(file) ? fileHash(workspacePath(root, relative)) : null;
}
