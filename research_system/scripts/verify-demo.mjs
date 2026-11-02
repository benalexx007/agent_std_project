import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './harness.mjs';
import { ROOT, readJSON, writeJSON, requireThat, inside, hash, now } from '../src/util.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-review-'));
try {
  const config = readJSON(path.join(ROOT, 'examples/recovery.json'));
  config.bundle_root = ROOT; config.project.workspace = directory;
  const configFile = path.join(directory, 'review-config.json');
  writeJSON(configFile, config);
  await main(['init', '--config', configFile]);
  await main(['register-task', '--config', configFile, '--file', path.join(ROOT, 'examples/task-recovery.json')]);
  await main(['run-task', '--config', configFile, '--task', 'parser_recovery', '--owner', 'local', '--epoch', '1', '--key', 'local-review', '--execute']);
  const snapshot = await main(['create-handoff', '--config', configFile]);
  const attempts = Object.values(snapshot.attempts);
  requireThat(snapshot.tasks.parser_recovery.status === 'completed', 'Demo did not complete');
  requireThat(attempts.length === 3 && attempts.every((a) => config.backends[a.backend].kind === 'mock'), 'Unexpected attempt/backend');
  requireThat(attempts.filter((a) => a.work_unit_id === 'define_contract').length === 1, 'Completed unit was repeated');
  const sourceFiles = ['src/engine.mjs', 'src/runner.mjs', 'src/resources.mjs', 'src/checkpoints.mjs', 'src/recovery.mjs', 'src/work.mjs'];
  const report = {
    kind: 'local_software_fixture_verification', generated_at: now(), node_version: process.version,
    package_version: readJSON(path.join(ROOT, 'package.json')).version,
    source_hashes: Object.fromEntries(sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))])),
    external_execution_enabled: config.execution.allow_external, scientific_evaluation_performed: false,
    final_task_status: snapshot.tasks.parser_recovery.status,
    work_units: Object.values(snapshot.work_units).map((u) => ({ id: u.spec.work_unit_id, status: u.status,
      attempts: u.attempts.length, generation: u.generation, transfers: u.transfers })),
    attempts: attempts.map((a) => ({ id: a.attempt_id, unit: a.work_unit_id, backend: a.backend,
      state: a.observed_state, failure: a.failure?.reason || null, has_final_answer: Boolean(a.result),
      checkpoint_id: a.checkpoint_id || null, resumed_from_checkpoint: a.resumed_from_checkpoint,
      supersedes_attempt_id: a.supersedes_attempt_id, usage_basis: a.usage_basis })),
    usage: snapshot.usage,
    limitations: ['Deterministic Node fixtures only; no claim about research quality, live provider compatibility or token savings.']
  };
  if (process.argv[2]) writeJSON(path.resolve(process.argv[2]), report);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  requireThat(inside(fs.realpathSync(os.tmpdir()), fs.realpathSync(directory)) && path.basename(directory).startsWith('agentic-review-'), 'Refusing cleanup outside the created review directory');
  fs.rmSync(directory, { recursive: true, force: true });
}
