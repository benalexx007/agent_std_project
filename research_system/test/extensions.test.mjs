import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fixture, task, resultFor } from './helpers.mjs';
import { ROOT, readJSON, fileHash, hash } from '../src/util.mjs';
import { extensionDocuments, resolveExtensions, verifyExtensionEnvironment, closeExtensionObservers } from '../src/extensions.mjs';
import { runExtension, reconcileExtensionCall } from '../src/extension-runner.mjs';
import { verifyExtensionNativeScope, inspectExtensionNativeScope, checkExtensionStartupScope } from '../src/extension-native.mjs';
import { beginAttempt, finishAttempt, hasLiveJobs, control, observeJob, handoff } from '../src/engine.mjs';
import { prepareWorkspace } from '../src/workspaces.mjs';
import { completeAttempt } from '../src/publication.mjs';
import { nativeToolHandler } from '../src/native-tools.mjs';
import { nativeThreadParams } from '../src/codex-native.mjs';
import { main } from '../scripts/harness.mjs';

// The pinned extension environment is machine-specific (absolute interpreter paths). Tests that need it run only when
// a locally provisioned environment matches the committed lock; otherwise they are skipped.
// Provision with `npm run extensions:provision`, then relock with `npm run extensions:lock`.
const available = (() => {
  try {
    const environmentFile = path.join(ROOT, '.research-environment/environment.json');
    const lock = readJSON(path.join(ROOT, 'extensions/research/lock.json'));
    return fileHash(path.join(ROOT, lock.environment)) === lock.environment_sha256 && fileHash(environmentFile) === lock.environment_sha256;
  } catch { return false; }
})();
const operations = Object.keys(readJSON(path.join(ROOT, 'extensions/research/manifest.json')).operations);
after(closeExtensionObservers);
function setup(t, modify = () => {}) {
  return fixture(t, (c) => {
    c.context.max_chars = 96000;
    c.workspace_policy = { mode: 'snapshot_directory', include: [], max_files: 100, max_bytes: 33554432, max_writers: 2 };
    c.extensions = { enabled: true, manifest: 'extensions/research/manifest.json', lock: 'extensions/research/lock.json',
      profiles: { research: { roles: ['researcher', 'implementer', 'evaluator'], backends: ['mock'], operations,
        network: true, limits: { timeout_ms: 20000, max_bytes: 4194304 }, native_policy: { skills: [], hooks: [], mcp_servers: [] } } } };
    modify(c);
  });
}
async function start(t, modify) {
  const f = setup(t, modify);
  task(f.store, { writes_workspace: true, extension_profile: 'research', expected_artifacts: [] });
  const a = beginAttempt(f.store, 'review_scope', 'local', 1, 'extensions').attempt;
  await prepareWorkspace(f.store, a.attempt_id);
  return { ...f, a, root: a.workspace.root };
}
const dataOf = (root, reply) => JSON.parse(fs.readFileSync(path.join(root, reply.artifacts.find((a) => a.path.endsWith('/result.json')).path), 'utf8'));
const body = (value, status = 200, headers = { 'content-type': 'application/json' }) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers });

test('native extension scope rejects inherited extras, discovery errors and repeated MCP pagination', async () => {
  await assert.rejects(checkExtensionStartupScope({ request: async () => ({ config: { mcp_servers: { ambient: { enabled: true } } } }) }, ROOT), /before thread startup/);
  const cwd = ROOT, binding = { fingerprint: 'pin', disclosure: 'harness_paged_resources', native_policy: { skills: [], hooks: [], mcp_servers: [] } };
  const inventory = { skills: { data: [{ cwd, skills: [], errors: [] }] }, hooks: { data: [{ cwd, hooks: [], errors: [] }] }, mcp: { data: [] } };
  assert.equal(verifyExtensionNativeScope(binding, inventory, cwd).binding_sha256, 'pin');
  inventory.skills.data[0].skills.push({ name: 'unexpected', enabled: true });
  assert.throws(() => verifyExtensionNativeScope(binding, inventory, cwd), /Inherited native skill/);
  inventory.skills.data[0].skills = [];
  inventory.mcp.data.push({ name: 'ambient' });
  assert.throws(() => verifyExtensionNativeScope(binding, inventory, cwd), /Inherited MCP/);
  await assert.rejects(inspectExtensionNativeScope({ request: async (method) => method === 'skills/list' ? inventory.skills : method === 'hooks/list' ? inventory.hooks : { data: [], nextCursor: 'same' } }, binding, cwd, 't'), /Repeated MCP cursor/);
});

test('dependency integrity rejects modified files and v4 migration fences a real writer3 connection', (t) => {
  const { store, directory } = fixture(t);
  const file = path.join(directory, 'dependency.py'); fs.writeFileSync(file, 'original');
  const env = { root: directory, files: { 'dependency.py': fileHash(file) } };
  verifyExtensionEnvironment(env, true); fs.writeFileSync(file, 'changed');
  assert.throws(() => verifyExtensionEnvironment(env, true), /dependency changed/);
  store.db.exec('DROP TRIGGER writer_generation_guard');
  store.transaction((s) => { s.schema_version = 3; });
  assert.throws(() => store.transaction(() => {}), /explicit v4 migration/);
  const migration = store.migrate(); assert.equal(migration.schema_version, 4); assert(fs.existsSync(migration.backup));
  const old = new DatabaseSync(store.file); old.function('harness_writer_version', () => 3);
  try { assert.throws(() => old.prepare('UPDATE state SET payload=payload WHERE id=1').run(), /compatible v4/); }
  finally { old.close(); }
  assert.equal(handoff(store.read()).schema_version, 4);
});

test('v3 emergency controls can close old work before explicit migration without enabling v3 dispatch', async (t) => {
  const { store, directory } = fixture(t); task(store);
  beginAttempt(store, 'review_scope', 'local', 1, 'legacy_active');
  store.db.exec('DROP TRIGGER writer_generation_guard');
  store.transaction((s) => { s.schema_version = 3; });
  assert.throws(() => store.migrate(), /active\/unknown/);
  await main(['control-task', '--workspace', directory, '--action', 'cancel', '--target', 'review_scope']);
  assert.equal(store.read().schema_version, 3); assert.equal(store.read().tasks.review_scope.desired_state, 'cancelled');
  assert(fs.readdirSync(path.join(directory, '.agentic')).some((p) => p.startsWith('pre-migration-control-')));
  assert.throws(() => beginAttempt(store, 'review_scope', 'local', 1, 'not_migrated'), /migration|Migrate/);
});

test('failed dependency staging never activates a partial environment', (t) => {
  const { directory } = fixture(t), target = path.join(directory, 'environment');
  const failed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/provision-extensions.mjs'), '--python', process.execPath, '--root', target, '--execute'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.notEqual(failed.status, 0); assert.equal(fs.existsSync(target), false);
  const dry = spawnSync(process.execPath, [path.join(ROOT, 'scripts/provision-extensions.mjs'), '--python', process.execPath, '--root', target],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).execute, false); assert.equal(fs.existsSync(target), false);
});

test('extension profiles are opt-in, scoped, immutable and absent from plain-task context', { skip: !available }, (t) => {
  const { store, loaded } = setup(t);
  assert.equal(resolveExtensions(loaded.config, { role: 'evaluator', backend: 'mock' }), null);
  assert.throws(() => resolveExtensions(loaded.config, { role: 'orchestrator', backend: 'mock', extension_profile: 'research', writes_workspace: true }), /role\/backend/);
  assert.throws(() => extensionDocuments({ ...loaded.config, extension_fingerprint: 'changed' }), /lock changed/);
  const base = { role: 'evaluator', backend: 'mock', extension_profile: 'research', writes_workspace: true };
  assert.throws(() => resolveExtensions(loaded.config, { ...base, extension_scope: { limits: { http_calls: 100 } } }), /expand extension limits/);
  const narrow = resolveExtensions(loaded.config, { ...base, extension_scope: { operations: ['math.check'], limits: { http_calls: 0 } } });
  assert.deepEqual(narrow.operations, ['math.check']); assert.equal(narrow.network, false);
  task(store); const plain = beginAttempt(store, 'review_scope', 'local', 1, 'plain');
  assert.equal(plain.context.packet.extensions, undefined);
});

test('native helper contract discovery is cheap and execution uses the same scoped dispatcher', { skip: !available }, async (t) => {
  const { store, a } = await start(t);
  const handle = nativeToolHandler(store, a.attempt_id);
  const description = await handle('harness_extension', { operation: 'math.check' }, 'describe');
  assert(description.input_schema); assert.equal(Object.keys(store.read().extension_calls).length, 0);
  const reply = await handle('harness_extension', { operation: 'math.check', arguments: { symbols: {}, expression: { integer: 2 } } }, 'execute');
  assert.equal(reply.status, 'completed');
  const task = store.read().tasks.review_scope.spec;
  const params = nativeThreadParams({ sandbox: 'workspace-write' }, task, { packet: { workspace: a.workspace.root, extensions: a.extension_binding } });
  assert.equal(params.config['sandbox_workspace_write.network_access'], false);
  assert(params.dynamicTools.some((d) => d.name === 'harness_extension'));
  assert(!nativeThreadParams({ sandbox: 'workspace-write' }, task, { packet: { workspace: a.workspace.root } }).dynamicTools.some((d) => d.name === 'harness_extension'));
});

test('symbolic AST handles assumptions and rejects executable expressions; duplicate IDs do not rerun', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t);
  const args = { symbols: { x: { real: true } }, expression: { op: 'sqrt', args: [{ op: 'power', args: [{ symbol: 'x' }, { integer: 2 }] }] } };
  const result = await runExtension(store, a.attempt_id, 'sqrt', 'math.check', args);
  assert.equal(result.status, 'completed'); assert.equal(dataOf(root, result).simplified, 'Abs(x)');
  const repeated = await runExtension(store, a.attempt_id, 'sqrt', 'math.check', args);
  assert.equal(repeated.call_id, result.call_id); assert.equal(Object.keys(store.read().extension_calls).length, 1);
  await assert.rejects(runExtension(store, a.attempt_id, 'sqrt', 'math.check', { ...args, symbols: {} }), /another payload/);
  const bad = await runExtension(store, a.attempt_id, 'bad', 'math.check', { symbols: {}, expression: { code: '__import__("os")' } });
  assert.equal(bad.status, 'failed'); assert.equal(hasLiveJobs(store.read().attempts[a.attempt_id]), false);
  const numeric = await runExtension(store, a.attempt_id, 'negative', 'math.check', { symbols: {}, expression: { op: 'sqrt', args: [{ op: 'power', args: [{ integer: -2 }, { integer: 2 }] }] } });
  assert.equal(dataOf(root, numeric).simplified, '2');
});

test('paired statistics match independent exact oracles and report degenerate bootstrap uncertainty', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t);
  const args = { a: [0, 0, 0, 0], b: [1, 1, 2, 2], method: 'sign_flip_exact', unit_of_analysis: 'matched fixture units' };
  const result = dataOf(root, await runExtension(store, a.attempt_id, 'paired', 'statistics.paired', args));
  assert.equal(result.mean_difference, 1.5); assert(Math.abs(result.sample_variance - 1 / 3) < 1e-12); assert.equal(result.two_sided_p, 0.125);
  const zero = dataOf(root, await runExtension(store, a.attempt_id, 'zero', 'statistics.paired', { ...args, b: [1, 1, 1, 1], method: 'bootstrap', seed: 1 }));
  assert.equal(zero.status, 'partial'); assert.equal(zero.confidence_interval, null);
});

test('bibliography keeps distinct DOI records with colliding keys and exposes raw failed blocks', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t);
  const text = '@string{j = "Journal"}\n@article{same,title={{First}},year={2020},doi={10.1234/a}}\n@article{same,title={Second},year={2021},doi={10.1234/b}}';
  fs.writeFileSync(path.join(root, 'sources.bib'), text);
  const reply = await runExtension(store, a.attempt_id, 'bib', 'bibliography.validate', { path: 'sources.bib' });
  const result = dataOf(root, reply);
  assert.equal(result.entries.length, 2); assert(result.issues.some((i) => i.kind === 'citation_key_collision'));
  assert.equal(result.rewritten, false); assert.equal(result.status, 'partial'); assert(result.failed_blocks[0].raw.includes('Second'));
  assert.equal(fs.readFileSync(path.join(root, 'sources.bib'), 'utf8'), text);
  const escape = await runExtension(store, a.attempt_id, 'escape', 'bibliography.validate', { path: '../outside.bib' });
  assert.equal(escape.status, 'failed'); assert.match(escape.error, /Invalid|escapes/);
});

test('retrieval fixtures preserve raw bytes/version and distinguish HTTP200 errors from an empty search', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t);
  const xml = '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:o="http://a9.com/-/spec/opensearch/1.1/"><o:totalResults>1</o:totalResults><entry><id>https://arxiv.org/abs/1706.03762v7</id><title>Fixture title</title></entry></feed>';
  const reply = await runExtension(store, a.attempt_id, 'arxiv', 'scholarly.arxiv', { id: '1706.03762v7' }, async () => body(xml));
  const result = dataOf(root, reply); assert.equal(result.data.entries[0].version, '7');
  const raw = reply.artifacts.find((r) => r.path.endsWith('raw-1.bin')); assert.equal(raw.sha256, hash(xml));
  const errorXml = xml.replace('Fixture title', 'Error');
  const error = dataOf(root, await runExtension(store, a.attempt_id, 'error', 'scholarly.arxiv', { id: 'missing' }, async () => body(errorXml)));
  assert.equal(error.status, 'partial'); assert.equal(error.parser_exit_code, 3);
});

test('OpenAlex/DOI fixtures report bounded paging and reject redirects outside the route', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t);
  const reply = await runExtension(store, a.attempt_id, 'alex', 'scholarly.openalex', { query: 'fixture', limit: 1 }, async () => body({ results: [{ id: 'https://openalex.org/W1', title: 'Fixture', abstract_inverted_index: { 'hello': [0] } }], meta: { count: 9, next_cursor: 'cursor' } }));
  const result = dataOf(root, reply); assert.equal(result.coverage, 'bounded_page'); assert.equal(result.continuation, 'cursor');
  const denied = await runExtension(store, a.attempt_id, 'redirect', 'bibliography.doi', { doi: '10.1234/fixture' }, async () => body('', 302, { location: 'https://example.invalid/private' }));
  assert.equal(denied.status, 'failed'); assert.match(denied.error, /origin/); assert.equal(store.read().extension_calls[denied.call_id].http_calls, 1);
});

test('provider admission and cancellation retain accounting and fence unresolved extension jobs', { skip: !available }, async (t) => {
  const { store, a } = await start(t);
  const pending = runExtension(store, a.attempt_id, 'pending', 'scholarly.crossref', { query: 'fixture' }, async (_, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true })));
  await assert.rejects(runExtension(store, a.attempt_id, 'second', 'scholarly.crossref', { query: 'fixture' }, async () => body({})), /capacity/);
  assert.equal(hasLiveJobs(store.read().attempts[a.attempt_id]), true);
  control(store, { event_id: 'pause_extensions', action: 'pause', target: 'review_scope', payload: {} });
  const stopped = await pending; assert.equal(stopped.status, 'failed'); assert.equal(store.read().extension_calls[stopped.call_id].http_calls, 1);
});

test('extension output publication uses the existing journal and detects post-call tampering', { skip: !available }, async (t) => {
  const { store, a, root, directory } = await start(t);
  const reply = await runExtension(store, a.attempt_id, 'plot', 'figure.plot', { x: [0, 1, 2], y: [0, 1, 4], xlabel: 'x', ylabel: 'x squared' });
  assert.equal(reply.status, 'completed', reply.error);
  const png = reply.artifacts.find((r) => r.path.endsWith('.png')); assert.deepEqual(fs.readFileSync(path.join(root, png.path)).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  if (process.env.HARNESS_EXTENSION_EVIDENCE === '1') { const out = path.join(ROOT, 'docs/verification/extensions'); fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(path.join(root, png.path), path.join(out, 'figure.png')); }
  const completed = await completeAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) });
  assert.equal(completed.observed_state, 'completed'); assert(fs.existsSync(path.join(directory, png.path)));
  assert(completed.result.artifacts.some((r) => r.path.endsWith('/receipt.json')));
});

test('changed helper output cannot be published as the pinned result', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t);
  const reply = await runExtension(store, a.attempt_id, 'integer', 'math.check', { symbols: {}, expression: { integer: 2 } });
  const ref = reply.artifacts.find((r) => r.path.endsWith('/result.json'));
  fs.writeFileSync(path.join(root, ref.path), '{"changed":true}');
  await assert.rejects(completeAttempt(store, a.attempt_id, { status: 'completed', result: resultFor(a) }), /hash mismatch|Helper output changed/);
  assert.equal(store.read().publication, null);
});

test('a helper spawn commit failure stops the known process and retains the failed call evidence', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t);
  const transaction = store.transaction.bind(store); let injected = false;
  store.transaction = (fn) => transaction((s) => {
    const result = fn(s);
    if (!injected && s.attempts[a.attempt_id].job_refs.some((j) => j.kind === 'extension' && j.pid)) {
      injected = true; throw new Error('Injected helper spawn commit failure');
    }
    return result;
  });
  const reply = await runExtension(store, a.attempt_id, 'commit_failure', 'math.check', { symbols: {}, expression: { integer: 2 } });
  assert.equal(reply.status, 'failed'); assert.match(reply.error, /spawn commit failure/);
  assert.equal(hasLiveJobs(store.read().attempts[a.attempt_id]), false);
  assert(!fs.existsSync(path.join(root, '.agentic/extension-work')));
  const call = store.read().extension_calls[reply.call_id]; assert(call.artifacts.some((r) => r.path.endsWith('/receipt.json')));
});

test('bounded retrieval records HTTP and malformed/oversized-response failures without live services', { skip: !available }, async (t) => {
  const { store, a } = await start(t, (c) => { c.extensions.profiles.research.limits.max_bytes = 512; });
  for (const [key, response, expected] of [
    ['quota', () => body({ error: 'limited' }, 429), /HTTP failure: 429/],
    ['badjson', () => body('broken'), /JSON|Unexpected/],
    ['huge', () => body('x'.repeat(2048)), /byte bound/]
  ]) {
    const reply = await runExtension(store, a.attempt_id, key, 'scholarly.crossref', { query: 'fixture' }, async () => response());
    assert.equal(reply.status, 'failed'); assert.match(reply.error, expected);
  }
  assert.equal(hasLiveJobs(store.read().attempts[a.attempt_id]), false);
});

function pdfFixture() {
  const text = 'BT /F1 12 Tf 20 60 Td (x^2 = 4; table a=1 b=2) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out);
  out += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return out;
}
test('PDF reuse extracts page locators and renders the same source with the pinned existing renderer', { skip: !available }, async (t) => {
  const { store, a, root } = await start(t); fs.writeFileSync(path.join(root, 'paper.pdf'), pdfFixture());
  const read = dataOf(root, await runExtension(store, a.attempt_id, 'pdf', 'paper.read', { path: 'paper.pdf', pages: [1] }));
  assert.match(read.pages[0].text, /x\^2 = 4/); assert.equal(read.layout_verified, false);
  const render = await runExtension(store, a.attempt_id, 'render', 'paper.render', { path: 'paper.pdf', page: 1 });
  assert.equal(render.status, 'completed', render.error);
  const png = render.artifacts.find((r) => r.path.endsWith('/page.png')); assert(png);
  if (process.env.HARNESS_EXTENSION_EVIDENCE === '1') { const out = path.join(ROOT, 'docs/verification/extensions'); fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(path.join(root, png.path), path.join(out, 'paper-page.png')); }
});

test('terminal job observation is required to reconcile a lost extension reply', (t) => {
  const { store, directory } = fixture(t); task(store);
  const a = beginAttempt(store, 'review_scope', 'local', 1, 'lost').attempt;
  store.transaction((s) => { s.extension_calls.lost = { call_id: 'lost', attempt_id: a.attempt_id, job_id: 'extjob', status: 'running', reserved_http_calls: 4 };
    s.attempts[a.attempt_id].job_refs.push({ job_id: 'extjob', kind: 'extension', observed_state: 'unknown' }); });
  const unknown = finishAttempt(store, a.attempt_id, { status: 'failed', error: 'lost bridge' });
  assert.equal(unknown.settled, false);
  assert.throws(() => reconcileExtensionCall(store, 'lost', 'local', 1), /terminal helper/);
  fs.writeFileSync(path.join(directory, 'stopped.txt'), 'fixture stop evidence');
  observeJob(store, a.attempt_id, 'extjob', { status: 'failed', evidence: [{ path: 'stopped.txt', sha256: fileHash(path.join(directory, 'stopped.txt')) }] });
  const reconciled = reconcileExtensionCall(store, 'lost', 'local', 1);
  assert.equal(reconciled.http_calls, 4); assert.equal(reconciled.usage_precision, 'conservative_envelope');
});
