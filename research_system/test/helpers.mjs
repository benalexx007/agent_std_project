import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, readJSON, clone } from '../src/util.mjs';
import { loadConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { registerTask } from '../src/engine.mjs';

export function fixture(t, modify = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-test-'));
  const raw = readJSON(path.join(ROOT, 'examples/research.json'));
  raw.bundle_root = ROOT;
  raw.project.workspace = directory;
  // Local fixtures must not inherit a live cross-backend default from the user-facing presets.
  raw.model_policy.task_class_backends = {};
  modify(raw);
  const file = path.join(directory, 'config.json');
  fs.writeFileSync(file, JSON.stringify(raw));
  const loaded = loadConfig(file);
  const store = new Store(directory, true);
  store.initialize(loaded);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, loaded, directory, configFile: file };
}
export function spec(overrides = {}) {
  return { ...clone(readJSON(path.join(ROOT, 'examples/task-small.json'))), ...overrides };
}
export function task(store, overrides = {}) {
  const value = spec(overrides);
  registerTask(store, value);
  return value;
}
export function resultFor(attempt, changes = {}) {
  return { task_id: attempt.task_id, task_revision: attempt.task_revision, attempt_id: attempt.attempt_id,
    protocol_version: attempt.protocol_version, status: 'completed', summary: 'Fixture result',
    artifacts: [], evidence_refs: [], checks: [{ name: 'fixture', passed: true, details: 'Only a harness fixture' }],
    limitations: ['No scientific claim'], unresolved: [],
    usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0, cost_usd: 0 }, ...changes };
}
