// P0 evidence collector. No agent thread/turn, inference, approvals or config writes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, readJSON, hash } from '../../../src/util.mjs';
import { loadConfig } from '../../../src/config.mjs';
import { Store } from '../../../src/store.mjs';
import { registerTask } from '../../../src/engine.mjs';
import { buildContext } from '../../../src/context.mjs';
import { getUnit } from '../../../src/work.mjs';
import { budgetAdmission } from '../../../src/resources.mjs';
import { selectModel } from '../../../src/models.mjs';
import { probeCodex, nativeThreadParams } from '../../../src/codex-native.mjs';
import { NativeRPC } from '../../../src/native-rpc.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const report = { kind: 'P0_metadata_and_static_preflight_not_inference', started_at: new Date().toISOString(),
  authorization: 'User approved P0 on 2026-10-27 in this conversation; L1/L2 are not authorized.',
  node: process.version, platform: process.platform, architecture: process.arch, os_release: os.release(),
  inference_requests: 0, native_threads_created: 0, live_model_access_verified: false, checks: {}, rpc_calls: [], warnings: [], blockers: [] };
const check = (name, passed, details) => {
  report.checks[name] = { passed: Boolean(passed), details };
  if (!passed) report.blockers.push(name);
};
const configFile = path.join(ROOT, 'examples/codex-native.json');
const loaded = loadConfig(configFile), backend = loaded.config.backends.codex_native;
const originalHash = hash(fs.readFileSync(configFile));
report.binary = probeCodex(backend);
report.binary.sha256 = hash(fs.readFileSync(report.binary.command));
check('version_pin', report.binary.version === backend.native.version, report.binary.version);
check('external_execution_remains_disabled', !loaded.config.execution.allow_external &&
  !loaded.config.backends.codex_native.allow_execute && !loaded.config.backends.codex_writer.allow_execute, 'No execution flags are changed.');
const staticCheck = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-project.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
save('static-check.json', { status: staticCheck.status, result: staticCheck.status === 0 ? JSON.parse(staticCheck.stdout) : null });
check('static_config_schema_syntax', staticCheck.status === 0, staticCheck.error?.message || 'See static-check.json');
const s0 = readJSON(path.join(ROOT, 'docs/verification/v1-evidence.json'));
const mismatches = Object.entries(s0.source_hashes).filter(([file, expected]) => !fs.existsSync(path.join(ROOT, file)) || hash(fs.readFileSync(path.join(ROOT, file))) !== expected).map(([file]) => file);
check('existing_S0_evidence_current', mismatches.length === 0 && s0.tests.passed === 161, { source_files: Object.keys(s0.source_hashes).length, mismatches, tests_reused: s0.tests.passed, rerun: false });
const pinned = readJSON(path.join(ROOT, 'docs/verification/codex-protocol-pin.json'));
report.protocol = Object.fromEntries(Object.entries(pinned.files).map(([file, expected]) => {
  const actual = hash(fs.readFileSync(path.join(directory, 'protocol', file)));
  return [file, { sha256: actual, matches_previous_pin: actual === expected.sha256 }];
}));
check('generated_protocol_matches_pin', Object.values(report.protocol).every((v) => v.matches_previous_pin), 'Generated from the actual pinned binary; no model calls.');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
report.source_hashes = Object.fromEntries(['package.json', 'examples/codex-native.json', ...['src', 'adapters', 'schemas', 'domains', 'skills', 'scripts', 'benchmarks'].flatMap((d) => walk(path.join(ROOT, d)).map((f) => path.relative(ROOT, f).replaceAll('\\', '/')))].map((f) => [f, hash(fs.readFileSync(path.join(ROOT, f)))]));

// Local scratch fixtures only. They never become a benchmark request or dispatch.
const workspace = path.join(directory, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
const raw = readJSON(configFile);
raw.bundle_root = ROOT; raw.project.workspace = workspace; raw.project.id = 'p0-context-only-2026-10-27';
save('workspace/config.json', raw);
const fixtures = { 'primary-spec.md': 'Skip empty values. Count missing separately. Primary data outranks analysis notes.\n',
  'values.csv': 'value\n2\n4\n6\n\n', 'analysis-note.md': 'Unverified mean=3; independently verify against primary data.\n' };
for (const [name, content] of Object.entries(fixtures)) fs.writeFileSync(path.join(workspace, name), content);
const local = loadConfig(path.join(workspace, 'config.json')), store = new Store(workspace, true);
let nativeParams;
try {
  store.initialize(local);
  const input = readJSON(path.join(ROOT, 'examples/task-small.json'));
  Object.assign(input, { task_id: 'p0_analysis_context', backend: 'codex_native', task_class: 'analysis',
    objective: 'Read primary-spec.md and values.csv independently. Check analysis-note.md. Return count, missing, sum and mean with primary evidence refs; no novelty claim.',
    inputs: Object.keys(fixtures).map((file) => ({ path: file, include: true, sha256: hash(fs.readFileSync(path.join(workspace, file))) })),
    budget: { reservation_tokens: 8000, reservation_cost_usd: 0, max_attempts: 1, timeout_ms: 480000, max_total_tokens: 24000 } });
  registerTask(store, input);
  const state = store.read(), task = state.tasks[input.task_id].spec;
  const context = buildContext(state.config, task, [], [], state);
  const admission = budgetAdmission(state, state.tasks[task.task_id], getUnit(state, task.task_id), task.backend, context);
  nativeParams = nativeThreadParams(backend, task, context);
  save('analysis-context.json', context.packet);
  save('native-thread-params-not-submitted.json', nativeParams);
  report.context = { scope: 'Proposed L1 read-only analysis fixture, sizing only; not a frozen L1 execution request.',
    characters: context.characters, max_chars: state.config.context.max_chars, sha256: context.sha256,
    input_tokens_estimated: admission.context_tokens_estimate, tokenizer: 'characters/2 estimate; not exact',
    reservation_tokens_estimated: admission.estimate.tokens, aggregate_token_cap_candidate: 24000,
    admission_allowed_for_token_sizing: admission.allowed, warnings: admission.warnings,
    configured_cost_placeholder_usd: 0, actual_cost_estimate_usd: null,
    cost_note: 'Zero is the inactive example placeholder; no cost approval or measured zero is inferred.' };
  check('analysis_context_fits', admission.allowed && context.characters <= state.config.context.max_chars, report.context);
  check('input_files_readable_and_pinned', context.packet.inputs.every((r) => { fs.accessSync(path.join(workspace, r.path), fs.constants.R_OK); return r.sha256 === hash(fs.readFileSync(path.join(workspace, r.path))); }), 'Harness process can read fixture inputs; backend enforcement is not exercised.');
  check('native_request_policy_static', nativeParams.approvalPolicy === 'never' && nativeParams.sandbox === 'read-only' &&
    nativeParams.allowProviderModelFallback === false && nativeParams.config['agents.enabled'] === false, 'Rendered parameters only; no thread/start is sent. Runtime receipt/enforcement is deferred to L1.');
  check('no_attempt_or_benchmark_started', Object.keys(store.read().attempts).length === 0 && !store.read().benchmarks, 'Scratch state contains only a queued sizing task.');
} finally { store.close(); }
report.model_policy = ['synthesis_planning', 'analysis', 'automation'].map((task_class) => ({ task_class, ...selectModel(loaded.config, { backend: 'codex_native', task_class }) }));

const allowed = new Set(['initialize', 'account/read', 'account/rateLimits/read', 'model/list', 'config/read', 'configRequirements/read']);
const child = spawn(report.binary.command, ['app-server', '--stdio'], { cwd: workspace, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stderrBytes = 0, closed = false;
child.stderr.on('data', (data) => { stderrBytes += data.length; });
const exit = new Promise((resolve) => { child.once('error', (e) => resolve({ error: e.message })); child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); }); });
const rpc = new NativeRPC(child.stdout, child.stdin, { timeoutMs: 20000, maxFrameBytes: 2097152 });
rpc.on('fault', () => {});
rpc.on('request', (message) => rpc.reject(message.id, 'P0 observer cannot approve, run tools or answer agent questions'));
const read = async (method, params = {}) => {
  if (!allowed.has(method)) throw new Error('P0 forbids RPC method: ' + method);
  const entry = { method, started_at: new Date().toISOString() }; report.rpc_calls.push(entry);
  try { const result = await rpc.request(method, params); entry.status = 'ok'; return result; }
  catch (error) { entry.status = 'error'; entry.error = error.message; throw error; }
};
try {
  report.initialize = await read('initialize', { clientInfo: { name: 'research_harness_p0_metadata', version: '0.4.0' }, capabilities: { experimentalApi: true } });
  rpc.notify('initialized');
  const account = await read('account/read', { refreshToken: false });
  report.account = { type: account.account?.type ?? null, plan_type: account.account?.planType ?? null, requires_openai_auth: account.requiresOpenaiAuth, identity_omitted: true };
  check('subscription_auth_metadata', ['chatgpt', 'chatgptAuthTokens'].includes(report.account.type), report.account);
  try {
    const quota = await read('account/rateLimits/read');
    report.quota = Object.fromEntries(['ordinaryUsageAllowed', 'rateLimits', 'rateLimitsByLimitId'].filter((key) => Object.hasOwn(quota, key)).map((key) => [key, quota[key]]));
  }
  catch (error) { report.quota = { unavailable: true, reason: error.message }; report.warnings.push('Quota metadata unavailable; no token conversion or quota guarantee.'); }
  const models = []; let cursor = null;
  for (let page = 0; page < 5; page++) {
    const response = await read('model/list', { limit: 100, includeHidden: true, cursor });
    models.push(...response.data); cursor = response.nextCursor;
    if (!cursor) break;
  }
  report.model_catalog = report.model_policy.map((policy) => {
    const found = models.find((m) => m.model === policy.model || m.id === policy.model);
    return { model: policy.model, effort: policy.reasoning_effort, present: Boolean(found),
      effort_supported: Boolean(found?.supportedReasoningEfforts?.some((e) => e.reasoningEffort === policy.reasoning_effort)),
      hidden: found?.hidden ?? null, inference_entitlement_verified: false };
  });
  check('requested_models_in_catalog', !cursor && report.model_catalog.every((m) => m.present && m.effort_supported), report.model_catalog);
  const cfg = await read('config/read', { cwd: workspace, includeLayers: false });
  // Allowlist only; never persist arbitrary config, provider secrets or account identifiers.
  const keys = ['model', 'model_provider', 'model_reasoning_effort', 'sandbox_mode', 'approval_policy', 'approvals_reviewer', 'features', 'windows'];
  report.ambient_config = Object.fromEntries(keys.filter((k) => Object.hasOwn(cfg.config, k)).map((k) => [k, cfg.config[k]]));
  const requirements = await read('configRequirements/read');
  report.requirements = requirements.requirements;
  check('metadata_RPC_available', true, 'initialize/account/config/models returned without thread/start or turn/start.');
} catch (error) { check('metadata_RPC_available', false, error.message); }
finally {
  child.stdin.end();
  const timer = setTimeout(() => { if (!closed) child.kill('SIGTERM'); }, 1500);
  const force = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 4000);
  report.observer_exit = await exit; clearTimeout(timer); clearTimeout(force);
  report.observer_stderr_bytes = stderrBytes;
}
check('observer_stopped', closed && report.observer_exit.code === 0, report.observer_exit);
check('example_config_unchanged', hash(fs.readFileSync(configFile)) === originalHash, originalHash);
report.deferred = ['No native thread created: effective thread policy receipt and OS enforcement require L1.',
  'No tool process or cancellation tree exercised: L2 remains conditional.',
  'Catalog/auth metadata does not prove inference entitlement.',
  'No approved L1 cost estimate or frozen execution request; L1 remains unapproved.'];
report.finished_at = new Date().toISOString();
report.verdict = report.blockers.length ? 'P0_BLOCKED' : 'P0_PASS_WITH_EXPLICIT_LIMITATIONS';
save('result.json', report);
console.log(JSON.stringify({ verdict: report.verdict, blockers: report.blockers, account: report.account, model_catalog: report.model_catalog,
  context: report.context, observer_exit: report.observer_exit, result: path.join(directory, 'result.json') }, null, 2));
