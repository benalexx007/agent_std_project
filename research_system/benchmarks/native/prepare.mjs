import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../src/config.mjs';
import { Store } from '../../src/store.mjs';
import { registerTask } from '../../src/engine.mjs';
import { requestBenchmark } from '../../src/benchmarks.mjs';
import { buildContext } from '../../src/context.mjs';
import { budgetAdmission } from '../../src/resources.mjs';
import { getUnit } from '../../src/work.mjs';
import { ROOT, id, hash, readJSON, writeJSON, requireThat } from '../../src/util.mjs';

// Preparation is deterministic. No function in this file launches a worker/model.
export function prepareNativeAcceptance({ directory, configFile, backendName, maxTokens = 24000, maxCostUsd, reservationCostUsd }) {
  requireThat(Number.isFinite(maxCostUsd) && maxCostUsd >= 0 && Number.isFinite(reservationCostUsd) && reservationCostUsd >= 0 &&
    maxCostUsd >= reservationCostUsd, 'Explicit maxCostUsd and reservationCostUsd estimates are required; unknown native price is not zero');
  const source = loadConfig(configFile), raw = readJSON(configFile);
  const backend = backendName || raw.orchestrator.backend;
  requireThat(raw.backends[backend]?.kind === 'codex-app-server' && raw.backends[backend].sandbox === 'read-only', 'L1 currently prepares a read-only Codex native profile');
  directory = path.resolve(directory);
  requireThat(!fs.existsSync(directory), 'Acceptance directory must be new');
  fs.mkdirSync(directory, { recursive: true });
  const requestId = id('native_l1');
  raw.project.workspace = directory; raw.bundle_root = source.config.bundle_root;
  raw.project.id = requestId; raw.project.objective = 'L1 native transport acceptance with a fixed oracle; no scientific discovery claim.';
  raw.execution.allow_external = true; raw.execution.max_attempts = 1; raw.execution.max_concurrent = 1;
  raw.execution.max_tokens = maxTokens; raw.execution.max_cost_usd = maxCostUsd;
  raw.recovery_policy = { automatic: false, candidates: [], max_same_backend_retries: 0, max_transfers: 0, max_segments_per_unit: 1, cooldown_ms: 1000 };
  for (const [name, b] of Object.entries(raw.backends)) b.allow_execute = name === backend;
  raw.roles.researcher.backend = backend;
  raw.budget_reserves = { orchestration_tokens: 0, verification_tokens: 0, recovery_tokens: 0, cost_usd: 0 };
  const configPath = path.join(directory, 'config.json'); writeJSON(configPath, raw);
  fs.writeFileSync(path.join(directory, 'primary-spec.md'), 'Skip empty values. Report nonempty count, missing count, sum and mean. Primary data outranks analysis notes.\n');
  fs.writeFileSync(path.join(directory, 'values.csv'), 'value\n2\n4\n6\n\n');
  fs.writeFileSync(path.join(directory, 'analysis-note.md'), 'Unverified analysis: mean=3. Check the primary data independently.\n');
  const spec = readJSON(path.join(ROOT, 'examples/task-small.json'));
  Object.assign(spec, { task_id: 'native_transport', role: 'researcher', backend, skills: ['research-scope'], task_class: 'analysis',
    purpose: 'benchmark', benchmark_request_id: requestId, expected_artifacts: [], writes_workspace: false,
    objective: 'Read primary-spec.md and values.csv independently. Check analysis-note.md against primary data. Return the standard result contract; summary must contain only a JSON string with keys count, missing, sum, mean and their computed numeric values. Include primary evidence refs; do not claim novelty.',
    inputs: ['primary-spec.md', 'values.csv', 'analysis-note.md'].map((file) => ({ path: file, include: true, sha256: hash(fs.readFileSync(path.join(directory, file))) })),
    budget: { reservation_tokens: 8000, reservation_cost_usd: reservationCostUsd, max_attempts: 1, timeout_ms: 480000, max_total_tokens: maxTokens } });
  const loaded = loadConfig(configPath), store = new Store(directory, true);
  try {
    store.initialize(loaded);
    registerTask(store, spec);
    const state = store.read(), record = state.tasks.native_transport;
    const context = buildContext(state.config, record.spec, [], [], state);
    const admission = budgetAdmission(state, record, getUnit(state, spec.task_id), backend, context);
    requireThat(admission.allowed, 'Preparation cannot fit approved candidate caps: ' + admission.message);
    const protocol = [
      '# L1 native acceptance — pending separate human confirmation',
      '', 'No model has been run. This is one read-only analysis attempt, zero native children, no retries.',
      'Backend/model/effort: ' + backend + ' / ' + record.spec.model + ' / ' + record.spec.reasoning_effort,
      'Binary pin: ' + raw.backends[backend].native.version,
      'Oracle: count=3, missing=1, sum=12, mean=4. Grade with grade.mjs; no LLM judge.',
      'Limits: one root attempt; ' + maxTokens + ' aggregate tokens; 480000ms deadline; configured estimated-cost cap USD ' + maxCostUsd + '.',
      'Cost basis: operator-supplied reservation estimate USD ' + reservationCostUsd + '. Native API cost telemetry may be unknown; this cap is not a guaranteed provider bill cap.',
      'Stop on first failure, quota/permission error, timeout or missing evidence. No automatic paid fallback.',
      'Steer/cancel/delegation/novelty and other models are outside this L1 scope.',
      'Before approval: review config/auth/billing and input admission. If these change, prepare a fresh request.',
      'After separate confirmation, use normal run-task --execute with the pinned config and dispatch key. The per-run benchmark guard must permit it.'
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(directory, 'protocol.md'), protocol);
    const executablePaths = ['package.json', 'scripts/harness.mjs', 'benchmarks/native/prepare.mjs', 'benchmarks/native/grade.mjs'];
    const sourceFiles = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? sourceFiles(dir + '/' + e.name) : [dir + '/' + e.name]);
    const manifest = { kind: 'native_l1_execution_manifest', input_refs: spec.inputs,
      source: Object.fromEntries([...executablePaths, ...sourceFiles('src'), ...sourceFiles('adapters'), ...sourceFiles('schemas')]
        .map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))])) };
    writeJSON(path.join(directory, 'execution-manifest.json'), manifest);
    const request = { request_id: requestId, purpose: 'benchmark', task_ids: [spec.task_id],
      protocol: { path: 'protocol.md', sha256: hash(protocol) },
      execution_manifest: { path: 'execution-manifest.json', sha256: hash(fs.readFileSync(path.join(directory, 'execution-manifest.json'))) },
      limits: { max_attempts: 1, max_tokens: maxTokens, max_cost_usd: maxCostUsd } };
    writeJSON(path.join(directory, 'request.json'), request);
    requestBenchmark(store, request, 'local', 1);
    return { prepared: true, executed: false, directory, request_id: requestId, admission, protocol: path.join(directory, 'protocol.md') };
  } finally { store.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => args[args.indexOf(name) + 1];
  try {
    requireThat(args.includes('--directory') && args.includes('--config') && args.includes('--max-cost-usd') && args.includes('--reservation-cost-usd'),
      'Required: --directory NEW_PATH --config FILE --max-cost-usd N --reservation-cost-usd N [--backend NAME]');
    process.stdout.write(JSON.stringify(prepareNativeAcceptance({ directory: opt('--directory'), configFile: opt('--config'),
      backendName: args.includes('--backend') ? opt('--backend') : undefined, maxCostUsd: Number(opt('--max-cost-usd')),
      reservationCostUsd: Number(opt('--reservation-cost-usd')) }), null, 2) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
