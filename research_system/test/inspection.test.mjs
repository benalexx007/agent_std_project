import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, task } from './helpers.mjs';
import { ROOT } from '../src/util.mjs';
import { inspectProject, renderInspection, redactInspection } from '../src/inspection.mjs';

test('inspect reads live WAL state without changing logical payload, schema or config', (t) => {
  const { store, directory, configFile } = fixture(t); task(store);
  const before = JSON.stringify(store.read());
  const schema = store.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
  const config = fs.readFileSync(configFile);
  const report = inspectProject({ config: configFile });
  assert.deepEqual(report.errors, []); assert.equal(report.sections.config.drift, false);
  assert.equal(report.sections.runtime.tasks.total, 1);
  assert.equal(report.sections.project.workspace, directory);
  assert.equal(JSON.stringify(store.read()), before);
  assert.deepEqual(store.db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all(), schema);
  assert.deepEqual(fs.readFileSync(configFile), config);
});

test('candidate drift and malformed config preserve registered snapshot; workspace rescue works', (t) => {
  const { store, directory, configFile } = fixture(t);
  const raw = JSON.parse(fs.readFileSync(configFile)); raw.execution.max_tokens += 1;
  fs.writeFileSync(configFile, JSON.stringify(raw));
  let r = inspectProject({ config: configFile });
  assert.equal(r.sections.config.drift, true);
  assert.equal(r.sections.policy.execution.max_tokens, store.read().config.execution.max_tokens);
  raw.roles.researcher.backend = 'missing'; fs.writeFileSync(configFile, JSON.stringify(raw));
  r = inspectProject({ config: configFile });
  assert.equal(r.sections.config.candidate_valid, false); assert.ok(r.errors.length);
  fs.writeFileSync(configFile, '{broken');
  assert.ok(inspectProject({ config: configFile }).errors.length);
  assert.equal(inspectProject({ workspace: directory }).errors.length, 0);
});

test('uninitialized valid candidate does not initialize state; corrupt DB is a partial error', (t) => {
  const { directory, configFile } = fixture(t);
  const raw = JSON.parse(fs.readFileSync(configFile)); raw.project.workspace = path.join(directory, 'new');
  fs.writeFileSync(configFile, JSON.stringify(raw));
  const r = inspectProject({ config: configFile });
  assert.equal(r.sections.project.initialized, false); assert.equal(r.errors.length, 0);
  assert.equal(fs.existsSync(raw.project.workspace), false);
  fs.mkdirSync(path.join(raw.project.workspace, '.agentic'), { recursive: true });
  fs.writeFileSync(path.join(raw.project.workspace, '.agentic/state.sqlite'), 'bad database');
  assert.equal(inspectProject({ config: configFile }).errors[0].source, 'state');
});

test('native inventory is historical, scope bound, and distinct from skill allowlists', (t) => {
  const { store, directory } = fixture(t);
  store.transaction((s) => { s.attempts.a = { attempt_id: 'a', config_hash: s.config_hash, extension_binding: { fingerprint: 'f' },
    effective_config: { model: 'frozen-model' }, native: { extension_scope: { checked_at: '2026-01-01', binding_sha256: 'f', skills: [], hooks: [], mcp_servers: [] } } }; });
  let r = inspectProject({ workspace: directory });
  assert.equal(r.sections.capabilities.gui_inventory.status, 'unknown');
  assert.equal(r.sections.capabilities.native_worker_observations.rows[0].status, 'historical_observation');
  assert.equal(r.sections.runtime.attempts.rows[0].effective_config.model, 'frozen-model');
  assert.equal(r.sections.skills[0].native_loaded, 'unknown');
  store.transaction((s) => { s.config_hash = 'changed'; });
  r = inspectProject({ workspace: directory });
  assert.equal(r.sections.capabilities.native_worker_observations.rows[0].status, 'stale');
});

test('report redacts credentials and escapes terminal control input before both renderers', () => {
  const r = redactInspection({ api_key: 'KEY', max_tokens: 123, env: { CUSTOM: 'ENV' }, headers: { Custom: 'HDR' },
    args: ['--api-key', 'ARG', '--token=INLINE'], url: 'https://user:PASS@host/?token=QUERY', text: '\x1b[2Jhello' });
  const text = JSON.stringify(r);
  for (const secret of ['KEY', 'ENV', 'HDR', 'ARG', 'INLINE', 'PASS', 'QUERY']) assert.ok(!text.includes(secret));
  assert.equal(r.max_tokens, 123); assert.ok(!r.text.includes('\x1b'));
});

test('paging is explicit; full and filtered reports remain available without native calls', (t) => {
  const { store, directory } = fixture(t);
  store.transaction((s) => { for (let i = 0; i < 15; i++) s.tasks['t' + i] = { status: 'queued' }; });
  const r = inspectProject({ workspace: directory });
  assert.equal(r.sections.runtime.tasks.omitted, 5);
  const full = inspectProject({ workspace: directory, full: true, section: 'runtime' });
  assert.deepEqual(Object.keys(full.sections), ['runtime']); assert.equal(full.sections.runtime.tasks.rows.length, 15);
  const rendered = renderInspection(r, { width: 80 });
  assert.ok(rendered.includes('GUI inventory')); assert.ok(rendered.split('\n').every((l) => Array.from(l).length <= 80));
  assert.throws(() => inspectProject({ workspace: directory, section: 'invalid' }));
  assert.throws(() => inspectProject({ workspace: directory, config: path.join(ROOT, 'examples/research.json') }));
});

test('CLI emits machine-readable JSON, correct exit codes and no initialization side effects', (t) => {
  const { directory, configFile } = fixture(t);
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/harness.mjs'), 'inspect-project', ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const r = cli('--workspace', directory, '--format', 'json', '--section', 'skills');
  assert.equal(r.status, 0, r.stderr); assert.deepEqual(Object.keys(JSON.parse(r.stdout).sections), ['skills']);
  assert.equal(cli('--workspace', directory, '--execute').status, 2);
  assert.equal(cli('--workspace', directory, '--config', configFile).status, 2);
  assert.equal(cli('--workspace', path.join(directory, 'absent')).status, 1);
  assert.equal(fs.existsSync(path.join(directory, 'absent')), false);
});

test('legacy state can be read without migration; unsupported version is clearly partial', (t) => {
  const { store, directory } = fixture(t);
  store.db.exec('DROP TRIGGER writer_generation_guard');
  for (const version of [3, 99]) {
    const s = store.read(); s.schema_version = version;
    store.db.prepare('UPDATE state SET payload=? WHERE id=1').run(JSON.stringify(s));
    const report = inspectProject({ workspace: directory });
    assert.equal(report.sections.project.state_version, version);
    assert.equal(report.errors.length, version === 3 ? 0 : 1);
    assert.equal(store.read().schema_version, version);
  }
});
