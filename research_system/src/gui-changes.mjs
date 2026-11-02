import path from 'node:path';
import { normalizeConfig, resolveTask } from './config.mjs';
import { checkedAttachment, guiBusy } from './gui-state.mjs';
import { clone, requireThat, hash, now, id, artifactCheck } from './util.mjs';
import { initialPools } from './resources.mjs';

// JSON Merge Patch: objects merge; null removes a key; arrays replace atomically.
export function mergePatch(value, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch);
  const result = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
  for (const [key, child] of Object.entries(patch)) {
    requireThat(!['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe patch key');
    if (child === null) delete result[key]; else result[key] = mergePatch(result[key], child);
  }
  return result;
}
function inputConfig(c) { const next = clone(c); delete next.extension_fingerprint; return next; }
function validateTarget(s, patch, restoreRevision) {
  const archived = restoreRevision === undefined ? null : s.gui.revisions.find((r) => r.revision === restoreRevision);
  requireThat(restoreRevision === undefined || archived, 'Unknown rollback revision');
  const loaded = normalizeConfig(archived ? inputConfig(archived.config) : mergePatch(inputConfig(s.config), patch), path.join(s.project.workspace, 'project-config.json'));
  requireThat(loaded.config.project.id === s.project.id && path.resolve(loaded.config.project.workspace) === path.resolve(s.project.workspace) && loaded.config.bundle_root === s.config.bundle_root,
    'Project identity/workspace/bundle cannot be changed through GUI configuration');
  for (const t of Object.values(s.tasks)) resolveTask(loaded.config, t.spec);
  return loaded;
}
function protectedChange(old, next) {
  // Conservative classification, with explicit approval outside model-authored payloads.
  return ['execution', 'autonomy', 'backends', 'extensions', 'budget_reserves', 'quota_pools', 'workspace_policy', 'project', 'research_profile']
    .some((key) => JSON.stringify(old[key]) !== JSON.stringify(next[key]));
}
export function proposeGuiChange(store, auth, input) {
  const { s } = checkedAttachment(store, auth, true);
  requireThat(Number.isSafeInteger(input.base_revision) && input.base_revision === s.gui.revision, 'Stale base revision');
  requireThat(input.restore_revision !== undefined || input.patch && typeof input.patch === 'object' && !Array.isArray(input.patch), 'Object merge patch required');
  const loaded = validateTarget(s, input.patch || {}, input.restore_revision);
  const overlay = input.overlay === undefined ? s.improvements?.active ?? null : input.overlay;
  checkOverlay(s, overlay);
  const change = { change_id: id('change'), base_revision: s.gui.revision, patch: clone(input.patch || {}), restore_revision: input.restore_revision,
    config: loaded.config, config_hash: loaded.config_hash, overlay, message_ref: input.message_ref || null,
    effect: { applies_to: 'future task registration/preparation; existing task specs require explicit revision',
      affected_tasks: Object.keys(s.tasks), changed_config_groups: Object.keys(loaded.config).filter((k) => JSON.stringify(loaded.config[k]) !== JSON.stringify(s.config[k])),
      overlay_changed: overlay !== (s.improvements?.active ?? null), host_reload_verified: false },
    needs_human: protectedChange(s.config, loaded.config), status: 'ready', at: now() };
  change.digest = hash(JSON.stringify(change));
  if (change.needs_human) change.status = 'pending_user';
  return store.transaction((next) => {
    checkedAttachment(store, auth, true);
    requireThat(next.gui.revision === change.base_revision && next.owner.epoch === s.owner.epoch, 'Revision/owner changed while validating');
    next.gui.changes[change.change_id] = change;
    return change;
  });
}
function checkOverlay(s, overlay) {
  if (overlay == null) return;
  const c = s.improvements?.changes[overlay];
  requireThat(c && c.checks.every((check) => check.passed), 'Overlay missing or failing checks');
  artifactCheck(s.project.workspace, c.manifest);
  c.files.forEach((f) => artifactCheck(s.project.workspace, f));
  c.checks.flatMap((c) => c.evidence).forEach((r) => artifactCheck(s.project.workspace, r));
}
export function applyGuiChange(store, auth, changeId) {
  checkedAttachment(store, auth, true);
  return store.transaction((s) => {
    checkedAttachment(store, auth, true);
    const c = Object.hasOwn(s.gui.changes, changeId) ? s.gui.changes[changeId] : null; requireThat(c, 'Unknown change');
    if (c.status === 'applied') return { change_id: changeId, revision: c.applied_revision, duplicate: true };
    requireThat(c.base_revision === s.gui.revision, 'Change conflict: propose again on current revision');
    requireThat(!c.needs_human || c.human_confirmation?.digest === c.digest, 'Explicit human confirmation required for protected change');
    requireThat(c.status !== 'rejected', 'Change rejected');
    if (guiBusy(s)) { c.status = 'deferred'; return { change_id: changeId, status: 'deferred', reason: 'Resolve active/unknown executions or publication; idle attachment does not block' }; }
    const loaded = validateTarget(s, c.patch, c.restore_revision);
    requireThat(loaded.config_hash === c.config_hash, 'Config/environment changed since preview');
    checkOverlay(s, c.overlay);
    const pools = initialPools(c.config);
    for (const [pid, p] of Object.entries(pools)) if (s.pools[pid]) Object.assign(p, { ...s.pools[pid], definition: p.definition });
    s.config_history = [...(s.config_history || []), { config_hash: s.config_hash, changed_at: now() }];
    s.config = clone(c.config); s.project = clone(c.config.project); s.config_hash = c.config_hash; s.pools = pools;
    s.improvements ||= { active: null, changes: {}, events: [] };
    const previous = s.improvements.active; s.improvements.active = c.overlay;
    s.improvements.events.push({ action: 'gui_activation', previous, change_id: c.overlay, at: now() });
    s.gui.revision++;
    s.gui.revisions.push({ revision: s.gui.revision, at: now(), config_hash: s.config_hash, config: clone(s.config), overlay: c.overlay, change_id: changeId });
    c.status = 'applied'; c.applied_revision = s.gui.revision;
    return { change_id: changeId, status: 'applied', revision: s.gui.revision, config_hash: s.config_hash, host_reload: 'not implied; applies to future core preparations' };
  });
}
// Deliberately not in the GUI tool action catalog. Human CLI path, locally attested.
export function confirmGuiChange(store, input) {
  requireThat(input.source === 'human_cli' && typeof input.statement === 'string' && input.statement.trim().length > 0, 'Human confirmation statement required');
  return store.transaction((s) => {
    const c = s.gui.changes[input.change_id];
    requireThat(c && c.digest === input.digest && c.base_revision === s.gui.revision, 'Confirmation is stale or mismatched');
    requireThat(!guiBusy(s), 'Resolve active/unknown work before protected confirmation');
    c.human_confirmation = { digest: c.digest, statement: input.statement, at: now(), trust: 'local_human_cli_attestation' };
    c.status = 'ready'; return { change_id: c.change_id, confirmed: true };
  });
}
