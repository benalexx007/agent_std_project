import fs from 'node:fs';
import path from 'node:path';
import { id, now, hash, writeJSON, requireThat, clone } from './util.mjs';
import { workspacePath } from './workspaces.mjs';

export function checkGuiTaskPaths(s, task) {
  for (const ref of task.inputs || []) workspacePath(s.project.workspace, ref.path, false);
  for (const p of [...(task.expected_artifacts || []), ...(task.work_units || []).flatMap((u) => u.expected_artifacts || [])]) workspacePath(s.project.workspace, p, false);
}

export function assertGui(s) { requireThat(s.schema_version === 5 && s.gui, 'Run upgrade-gui explicitly before GUI writes'); }
export function guiBusy(s) {
  return Boolean(s.publication) || Object.values(s.gui?.operations || {}).some((op) => ['submit_intent', 'running', 'unknown'].includes(op.state)) ||
    Object.values(s.attempts).some((a) => !a.settled || a.job_refs.some((j) => ['external', 'extension'].includes(j.kind) && !['completed', 'failed', 'cancelled', 'stopped'].includes(j.observed_state)));
}
export function upgradeGui(store) {
  const before = store.read();
  if (before.schema_version === 5) return { migrated: false, schema_version: 5 };
  requireThat(before.schema_version === 4, 'Migrate legacy state to v4 first');
  requireThat(!guiBusy(before), 'Resolve active/unknown work and publication before GUI migration');
  const backup = path.join(store.directory, 'migration-v4-' + id('backup') + '.json');
  writeJSON(backup, before);
  return store.transaction((s) => {
    requireThat(hash(JSON.stringify(s)) === hash(JSON.stringify(before)), 'State changed during migration');
    s.schema_version = 5;
    s.gui = { revision: 1, attachments: {}, changes: {}, operations: {}, events: {}, observations: {},
      revisions: [{ revision: 1, at: now(), config_hash: s.config_hash, config: clone(s.config), overlay: s.improvements?.active ?? null, source: 'migration' }] };
    s.migration = { from: 4, at: now(), backup };
    store.installWriterGuard();
    return { migrated: true, schema_version: 5, backup };
  });
}
export function attachGui(store, input) {
  requireThat(['codex', 'claude', 'antigravity'].includes(input.host), 'Unsupported GUI host');
  requireThat(typeof input.surface === 'string' && input.surface.length <= 100, 'Host surface required');
  const token = id('credential');
  const attachment = store.transaction((s) => {
    assertGui(s);
    requireThat(fs.realpathSync(s.project.workspace) === fs.realpathSync(path.join(store.directory, '..')) &&
      fs.realpathSync(s.config.project.workspace) === fs.realpathSync(path.join(store.directory, '..')), 'Project snapshot workspace differs from control root; explicit relocation required');
    const attachment_id = id('attachment');
    const a = { attachment_id, project_id: s.project.id, workspace: fs.realpathSync(store.directory + '/..'),
      host: input.host, surface: input.surface, host_version: input.host_version || null,
      session_hint: input.session_hint || null, identity_trust: 'local_attachment_not_verified_native_identity',
      token_hash: hash(token), owner_epoch: s.owner.epoch, access: input.access === 'read' ? 'read' : 'owner',
      created_at: now(), detached_at: null };
    s.gui.attachments[attachment_id] = a;
    return a;
  });
  return { ...attachment, token_hash: undefined, token };
}
export function checkedAttachment(store, auth, write = false) {
  return attachmentInState(store.read(), store, auth, write);
}
export function attachmentInState(s, store, auth, write = false) {
  assertGui(s);
  const a = Object.hasOwn(s.gui.attachments, auth?.attachment_id || '') ? s.gui.attachments[auth.attachment_id] : null;
  requireThat(a && !a.detached_at && typeof auth.token === 'string' && hash(auth.token) === a.token_hash, 'Invalid/detached GUI binding');
  requireThat(a.workspace === fs.realpathSync(path.join(store.directory, '..')) && a.project_id === s.project.id, 'GUI binding belongs to another project');
  requireThat(fs.realpathSync(s.project.workspace) === a.workspace && fs.realpathSync(s.config.project.workspace) === a.workspace, 'Project snapshot workspace differs from GUI binding');
  if (write) requireThat(a.access === 'owner' && a.owner_epoch === s.owner.epoch, 'Stale/read-only GUI owner; attach after explicit takeover');
  return { s, a };
}
