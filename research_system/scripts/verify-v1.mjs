// Authorized deterministic software checks only. This is not a model/science benchmark runner.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, hash, now, readJSON, writeJSON, requireThat } from '../src/util.mjs';

const outputDirectory = path.join(ROOT, 'docs/verification');
const guiMode = process.argv.includes('--gui');
const staticPath = guiMode ? 'docs/verification/gui-static-checks.json' : 'docs/verification/static-checks.json';
const testsPath = guiMode ? 'docs/verification/gui-software-tests.tap' : 'docs/verification/software-tests.tap';
const demoPath = guiMode ? 'docs/verification/gui-demo.json' : 'docs/local-verification.json';
const reportPath = guiMode ? 'docs/verification/gui-evidence.json' : 'docs/verification/v1-evidence.json';
fs.mkdirSync(outputDirectory, { recursive: true });
function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  requireThat(!r.error, r.error?.message || 'Check process failed');
  return r;
}
const checks = run(['scripts/check-project.mjs']);
fs.writeFileSync(path.join(ROOT, staticPath), checks.stdout);
requireThat(checks.status === 0, checks.stderr || checks.stdout);
const tests = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => 'test/' + f);
process.env.HARNESS_EXTENSION_EVIDENCE = '1';
const suite = run(['--test', '--test-concurrency=1', '--test-reporter=tap', ...tests]);
fs.writeFileSync(path.join(ROOT, testsPath), suite.stdout);
requireThat(suite.status === 0, suite.stderr || suite.stdout.slice(-5000));
const fallback = run(['scripts/verify-demo.mjs', demoPath]);
requireThat(fallback.status === 0, fallback.stderr || fallback.stdout);
function filesIn(directory) {
  return fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? filesIn(directory + '/' + e.name) : [directory + '/' + e.name]);
}
const sourceFiles = ['package.json', 'AGENTS.md', ...['src', 'schemas', 'skills', 'domains', 'adapters', 'scripts', 'test', 'benchmarks', 'extensions', 'integrations'].flatMap(filesIn),
  ...fs.readdirSync(path.join(ROOT, 'examples')).filter((f) => f.endsWith('.json')).map((f) => 'examples/' + f)].sort();
const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))]));
const count = (name) => Number(new RegExp('^# ' + name + ' (\\d+)$', 'm').exec(suite.stdout)?.[1]);
const evidence = [testsPath, staticPath, demoPath]
  .map((file) => ({ path: file, sha256: hash(fs.readFileSync(path.join(ROOT, file))) }));
const gateSources = {
  'V1-01': ['test/contracts.test.mjs', 'test/research.test.mjs', 'test/model-routing.test.mjs'],
  'V1-02': ['test/research.test.mjs', 'scripts/check-project.mjs'],
  'V1-03': ['test/research.test.mjs'], 'V1-04': ['test/engine.test.mjs', 'test/research.test.mjs'],
  'V1-05': ['test/research.test.mjs', 'test/planning.test.mjs'], 'V1-06': ['test/recovery.test.mjs', 'test/model-routing.test.mjs'],
  'V1-07': ['test/recovery.test.mjs', 'test/research.test.mjs', 'test/improvements.test.mjs'],
  'V1-08': ['test/runner.test.mjs', 'test/contracts.test.mjs'],
  'V1-09': ['test/runner.test.mjs', 'test/contracts.test.mjs', 'test/engine.test.mjs'],
  'V1-10': ['test/improvements.test.mjs', 'test/research.test.mjs'],
  'V1-11': ['docs/system-report.md', 'docs/verify.md']
};
for (const gate of ['V1-01', 'V1-04', 'V1-05', 'V1-06', 'V1-07', 'V1-08', 'V1-09', 'V1-10']) gateSources[gate].push('test/operational-review.test.mjs');
for (const gate of ['V1-01', 'V1-04', 'V1-06', 'V1-07', 'V1-08', 'V1-09']) gateSources[gate].push('test/native.test.mjs');
for (const gate of ['V1-01', 'V1-04', 'V1-06', 'V1-07', 'V1-08', 'V1-09', 'V1-10']) gateSources[gate].push('test/workspaces.test.mjs', 'test/foundation.test.mjs');
const report = { kind: 'local_software_verification_not_a_benchmark', generated_at: now(), node_version: process.version,
  package_version: readJSON(path.join(ROOT, 'package.json')).version, tests: { total: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), files: tests },
  static_checks: JSON.parse(checks.stdout), source_hashes: sourceHashes, source_fingerprint: hash(JSON.stringify(sourceHashes)), evidence,
  gates: Object.fromEntries(Object.entries(gateSources).map(([gate, sources]) => [gate, {
    status: gate === 'V1-11' ? 'report_prepared_pending_user_review' : 'automated_checks_passed_pending_user_review', sources, evidence: evidence.map((e) => e.path)
  }])),
  walkthrough_cases: ['C1: hypothesis and counterevidence', 'C2: mathematical obligations and proof levels', 'C3: experimental records and failed runs', 'C4: checkpoint, transfer and pause'],
  human_acceptance: 'pending', live_backends_verified: [], benchmark_runs: 0, scientific_discovery_evaluated: false,
  gui_integration: { source_version: '0.7.0', schema_version: 5, transport: 'project-local entry + bound CLI service',
    software_sources: ['test/gui.test.mjs', 'test/inspection.test.mjs'], hosts: ['codex', 'claude', 'antigravity'],
    loader_verified: false, native_identity_verified: false, live_acceptance: 'pending_separate_approval_or_authorized_real_use',
    coverage: 'Fixtures plus full core regression; connection generation is not live host certification' },
  integration_foundation: { source_version: '0.6.0', state_version: 4, evidence_level: 'fixture-verified',
    capabilities: ['snapshot_directory', 'journaled_publication', 'bounded_parallel_writers', 'checkpoint_materialization', 'native_history_collection',
      'native_percent_quota', 'scoped_usage_baselines', 'bounded_bundle_cache', 'paged_resource_reads'],
    live_verified: false, limitations: ['No Git worktree provider.', 'No warm process/session reuse, native groups or active reconnect.', 'Termination proof remains an operator attestation.'] },
  extensions: { source_version: '0.6.0', state_version: 4, implemented: true,
    environment_provisioned: fs.existsSync(path.join(ROOT, '.research-environment/environment.json')),
    fixture_verified: count('skipped') === 0, native_verified: false, benchmark_runs: 0,
    gates: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8'], source: 'test/extensions.test.mjs',
    limitation: 'Native catalog/sandbox enforcement needs exact-profile trace before live acceptance; external MCP execution and other backend bindings are not enabled.' },
  native_codex: { implemented: true, evidence_level: 'fixture-verified', model_inference_verified: false,
    delegation_mode: 'harness_workers', protocol_pin: 'docs/verification/codex-protocol-pin.json',
    limitations: ['Native child delegation disabled.', 'Unknown subprocesses still require reconciliation.', 'No warm session reuse or automatic native turn resubmission.'] },
  limitations: ['No LLM/model benchmark was run.', 'Contract/walkthrough tests do not establish research quality or novelty.',
    'Review/verifier receipts are attestations; the core does not semantically authenticate proofs.', 'Read docs/system-report.md for scope and unresolved limitations.'] };
requireThat(Number.isSafeInteger(report.tests.total) && report.tests.total > 0 && report.tests.failed === 0, 'Missing or failed test evidence');
requireThat(fs.existsSync(path.join(ROOT, 'docs/system-report.md')), 'Prepare the handoff report before publishing V1-11 evidence');
writeJSON(path.join(ROOT, reportPath), report);
process.stdout.write(JSON.stringify({ passed: true, tests: report.tests, evidence: reportPath, human_acceptance: report.human_acceptance,
  benchmark_runs: 0, scientific_discovery_evaluated: false }, null, 2) + '\n');
