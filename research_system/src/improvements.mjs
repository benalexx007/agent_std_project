import fs from 'node:fs';
import path from 'node:path';
import { contract } from './schema.mjs';
import { artifactCheck, confined, clone, hash, now, requireThat, writeJSON, fileHash } from './util.mjs';
import { researchEntry, researchValidity } from './research.mjs';

const ownership = (s, owner, epoch) => requireThat(owner === s.owner.id && Number(epoch) === s.owner.epoch, 'Stale improvement owner/epoch');
const active = (s) => s.improvements?.active ? s.improvements.changes[s.improvements.active] : null;
export function bundleResource(config, state, target) {
  const replacement = state && active(state)?.files.find((f) => f.target === target.replaceAll('\\', '/'));
  if (replacement) {
    artifactCheck(config.project.workspace, replacement);
    return { file: confined(config.project.workspace, replacement.path), ref: { target, path: replacement.path, sha256: replacement.sha256, root: 'workspace' } };
  }
  const file = confined(config.bundle_root, target);
  return { file, ref: { path: target, sha256: fileHash(file) } };
}

export function proposeImprovement(store, input, owner, epoch) {
  contract('improvement', input);
  let createdDirectory = null;
  try { return store.transaction((s) => {
    ownership(s, owner, epoch);
    requireThat(input.change_id !== 'original', 'The original bundle name is reserved for rollback');
    s.improvements ||= { active: null, changes: {}, events: [] };
    requireThat(!Object.hasOwn(s.improvements.changes, input.change_id), 'Improvement ID is immutable');
    for (const ref of input.feedback_refs) {
      const e = researchEntry(s, ref.record_id, ref.revision);
      requireThat(e.sha256 === ref.sha256 && e.record.kind === 'feedback' && researchValidity(s, e).current, 'Feedback reference must be current');
    }
    for (const check of input.checks) check.evidence.forEach((ref) => artifactCheck(s.project.workspace, ref));
    const files = new Map((active(s)?.files || []).map((f) => [f.target, clone(f)]));
    const targets = new Set(), prepared = [];
    for (const ref of input.files) {
      const target = ref.target.replaceAll('\\', '/');
      requireThat(/^(skills|domains)\/.+\.md$/.test(target) && !target.split('/').includes('..'), 'Only project skill/domain Markdown overlays are allowed');
      requireThat(!targets.has(target), 'Duplicate improvement target'); targets.add(target);
      confined(s.config.bundle_root, target); // Existing maintained resources only.
      artifactCheck(s.project.workspace, ref);
      const content = fs.readFileSync(confined(s.project.workspace, ref.path));
      if (target.endsWith('/SKILL.md')) {
        const skill = path.posix.basename(path.posix.dirname(target));
        requireThat(content.toString().match(/^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: [^\r\n]+\r?\n---\r?\n/)?.[1] === skill, 'Overlay skill metadata/name mismatch');
      }
      prepared.push({ target, content });
    }
    const relativeDirectory = path.posix.join('.agentic/improvements', input.change_id);
    const directory = confined(s.project.workspace, relativeDirectory, false);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.mkdirSync(directory); // Exclusive: never remove/reuse a pre-existing directory.
    createdDirectory = { workspace: s.project.workspace, relative: relativeDirectory, absolute: directory };
    for (const { target, content } of prepared) {
      const relative = path.posix.join(relativeDirectory, target);
      const file = confined(s.project.workspace, relative, false);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(file, 'wx');
      try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      files.set(target, { target, path: relative, sha256: hash(content) });
    }
    const change = { ...clone(input), files: [...files.values()], parent: s.improvements.active, config_hash: s.config_hash,
      created_at: now(), owner, verification_trust: 'recorded_checks_are_attestations' };
    const manifestPath = path.posix.join('.agentic/improvements', input.change_id, 'manifest.json');
    const manifestFile = confined(s.project.workspace, manifestPath, false);
    writeJSON(manifestFile, change);
    const record = { ...change, manifest: { path: manifestPath, sha256: hash(fs.readFileSync(manifestFile)) } };
    s.improvements.changes[input.change_id] = record;
    s.improvements.events.push({ action: 'proposed', change_id: input.change_id, at: now(), owner });
    return record;
  }); } catch (error) {
    if (createdDirectory) {
      const checked = confined(createdDirectory.workspace, createdDirectory.relative);
      requireThat(checked === createdDirectory.absolute, 'Refusing cleanup outside the newly created improvement directory');
      fs.rmSync(checked, { recursive: true, force: true });
    }
    throw error;
  }
}

export function activateImprovement(store, changeId, owner, epoch) {
  return store.transaction((s) => {
    requireThat(s.schema_version !== 5, 'GUI state requires versioned change.prepare/apply for overlay activation');
    ownership(s, owner, epoch);
    requireThat(!Object.values(s.attempts).some((a) => !a.settled || a.job_refs.some((j) => j.kind === 'external' && !['completed', 'failed', 'cancelled'].includes(j.observed_state))),
      'Resolve active/unknown attempts and external jobs before changing bundle');
    s.improvements ||= { active: null, changes: {}, events: [] };
    if (changeId !== 'original') {
      const change = s.improvements.changes[changeId];
      requireThat(change && change.config_hash === s.config_hash, 'Unknown improvement or config changed');
      requireThat(change.checks.every((c) => c.passed), 'Cannot activate a change with failing checks');
      artifactCheck(s.project.workspace, change.manifest);
      change.files.forEach((f) => artifactCheck(s.project.workspace, f));
      change.checks.flatMap((c) => c.evidence).forEach((f) => artifactCheck(s.project.workspace, f));
    }
    const previous = s.improvements.active;
    s.improvements.active = changeId === 'original' ? null : changeId;
    s.improvements.events.push({ action: 'activated', previous, change_id: s.improvements.active, at: now(), owner });
    return { active: s.improvements.active, previous, scope: 'project_only', config_hash: s.config_hash };
  });
}
