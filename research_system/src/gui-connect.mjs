import fs from 'node:fs';
import path from 'node:path';
import { ROOT, requireThat, confined, hash, readJSON } from './util.mjs';
import { readProjectState } from './inspection.mjs';
import { activeDomain } from './domains.mjs';

// Project-local entry, not a package installation or a claim about a running GUI loader.
export function connectGui(workspace, host, requestedDomain) {
  requireThat(['codex', 'claude', 'antigravity'].includes(host), 'Unsupported GUI host');
  const root = fs.realpathSync(workspace);
  const state = readProjectState(root);
  requireThat(!state || state.project?.domain === state.config?.project?.domain, 'GUI connection state/config domain mismatch');
  requireThat(!state || !requestedDomain || requestedDomain === state.project.domain, 'GUI connection domain differs from state');
  const domain = activeDomain(state?.project?.domain || requestedDomain || 'research');
  const base = host === 'claude' ? '.claude/skills/' + domain.gui_name : host === 'antigravity' ? '.agents/skills/' + domain.gui_name + '-antigravity' : '.agents/skills/' + domain.gui_name;
  const manifestPath = '.agentic/gui-connections/' + host + '.json';
  const entry = fs.readFileSync(path.join(ROOT, domain.gui_entry), 'utf8').replace('name: ' + domain.gui_name + '\n', 'name: ' + path.basename(base) + '\n');
  const connection = { version: domain.gui_connection_version, host, ...(domain.id !== 'research' ? { domain: domain.id } : {}), workspace: root, node: process.execPath, harness: path.join(ROOT, 'scripts/harness.mjs'),
    host_file: path.join(root, base, 'host.json'),
    loader_status: host === 'antigravity' ? 'manual_entry_required_until_exact_surface_verified' : 'project_skill_requires_host_discovery_and_trust',
    limitations: 'Generation does not verify GUI loading, identity, model, permissions or native inventory' };
  const contents = { [base + '/SKILL.md']: entry, [base + '/connection.json']: JSON.stringify(connection, null, 2) + '\n',
    [base + '/host.json']: JSON.stringify({ host, surface: host === 'claude' ? 'code-desktop' : 'desktop' }, null, 2) + '\n' };
  const manifest = { host, version: domain.gui_connection_version, ...(domain.id !== 'research' ? { domain: domain.id } : {}), files: Object.entries(contents).map(([p, text]) => ({ path: p, sha256: hash(text) })) };
  contents[manifestPath] = JSON.stringify(manifest, null, 2) + '\n';
  const targets = Object.entries(contents).map(([relative, text]) => ({ file: confined(root, relative, false), relative, text }));
  // Preflight all conflicts before the first write. Never replace a user's skill.
  for (const t of targets) if (fs.existsSync(t.file)) requireThat(fs.readFileSync(t.file, 'utf8') === t.text, 'Connection file conflict: ' + t.relative + '; disconnect the previous unmodified entry first');
  const created = [];
  try {
    for (const t of targets) if (!fs.existsSync(t.file)) {
      fs.mkdirSync(path.dirname(t.file), { recursive: true });
      fs.writeFileSync(t.file, t.text, { flag: 'wx', mode: 0o600 }); created.push(t.file);
    }
  } catch (error) { for (const file of created.reverse()) { try { fs.unlinkSync(file); } catch {} } throw error; }
  return { ...connection, files: manifest.files, manifest: manifestPath, generated: true, loader_verified: false,
    next: 'Open/trust this project in the chosen GUI; invoke ' + domain.gui_name + ' or read its entry explicitly. Initialize and upgrade state before attaching.' };
}

export function disconnectGui(workspace, host) {
  requireThat(['codex', 'claude', 'antigravity'].includes(host), 'Unsupported GUI host');
  const root = fs.realpathSync(workspace), manifestPath = '.agentic/gui-connections/' + host + '.json';
  const file = confined(root, manifestPath), manifest = readJSON(file);
  requireThat(manifest.host === host && manifest.version === 1 && Array.isArray(manifest.files), 'Invalid connection manifest');
  const base = host === 'claude' ? '.claude/skills/research-project/' : host === 'antigravity' ? '.agents/skills/research-project-antigravity/' : '.agents/skills/research-project/';
  const targets = manifest.files.map((r) => {
    requireThat([base + 'SKILL.md', base + 'connection.json', base + 'host.json'].includes(r.path), 'Unexpected connection path');
    const target = confined(root, r.path, false);
    requireThat(!fs.existsSync(target) || hash(fs.readFileSync(target)) === r.sha256, 'Modified connection file preserved: ' + r.path);
    return target;
  });
  targets.forEach((target) => { if (fs.existsSync(target)) fs.unlinkSync(target); }); fs.unlinkSync(file);
  return { disconnected: true, state_preserved: true, jobs_stopped: false, attachments_revoked: false,
    note: 'Detach the binding separately; removing discovery files does not stop work or delete research state' };
}
