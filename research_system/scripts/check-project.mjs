import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, readJSON, requireThat, confined } from '../src/util.mjs';
import { contract } from '../src/schema.mjs';
import { loadConfig, resolveTask } from '../src/config.mjs';

contract('extension-manifest', readJSON(path.join(ROOT, 'extensions/research/manifest.json')));
contract('config', readJSON(path.join(ROOT, 'examples/research-extensions.json')));
const extensionEnvironment = path.join(ROOT, '.research-environment/environment.json');
let pythonChecked = 0;
if (fs.existsSync(extensionEnvironment)) {
  const environment = readJSON(extensionEnvironment);
  const files = ['extensions/research/worker.py', ...fs.readdirSync(path.join(ROOT, 'extensions/research/vendor/paper_lookup')).filter((p) => p.endsWith('.py')).map((p) => 'extensions/research/vendor/paper_lookup/' + p)];
  const checked = spawnSync(environment.python, ['-I', '-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(encoding="utf-8"), filename=p) for p in sys.argv[1:]]', ...files], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  requireThat(checked.status === 0, checked.stderr || 'Python helper syntax failed'); pythonChecked = files.length;
}
const loaded = loadConfig(path.join(ROOT, 'examples/research.json'));
const tasks = ['task-small.json', 'task-long.json'];
for (const file of tasks) resolveTask(loaded.config, readJSON(path.join(ROOT, 'examples', file)));
resolveTask(loaded.config, readJSON(path.join(ROOT, 'examples/task-synthesis-planning.json')));
resolveTask(loaded.config, readJSON(path.join(ROOT, 'examples/task-small.json')), readJSON(path.join(ROOT, 'examples/override-evaluator.json')));
for (const name of ['planning', 'analysis', 'automation']) {
  resolveTask(loaded.config, readJSON(path.join(ROOT, 'examples/task-small.json')), readJSON(path.join(ROOT, 'examples/override-' + name + '.json')));
}
contract('decision', readJSON(path.join(ROOT, 'examples/decision.json')));
contract('task-review', readJSON(path.join(ROOT, 'examples/task-review.json')));
const recoveryConfig = loadConfig(path.join(ROOT, 'examples/recovery.json'));
const nativeConfig = loadConfig(path.join(ROOT, 'examples/codex-native.json'));
const isolatedConfig = loadConfig(path.join(ROOT, 'examples/research-isolated.json'));
resolveTask(isolatedConfig.config, readJSON(path.join(ROOT, 'examples/task-small.json')));
resolveTask(nativeConfig.config, readJSON(path.join(ROOT, 'examples/task-orchestrator.json')));
const paperConfig = loadConfig(path.join(ROOT, 'examples/research-paper.json'));
resolveTask(paperConfig.config, readJSON(path.join(ROOT, 'examples/task-small.json')), readJSON(path.join(ROOT, 'examples/override-proof.json')));
contract('research-record', readJSON(path.join(ROOT, 'examples/hypothesis.json')));
resolveTask(recoveryConfig.config, readJSON(path.join(ROOT, 'examples/task-recovery.json')));
contract('checkpoint-progress', readJSON(path.join(ROOT, 'examples/checkpoint-progress.json')));
contract('quota-snapshot', readJSON(path.join(ROOT, 'examples/quota-snapshot.json')));
const skills = [];
const guiEntry = fs.readFileSync(path.join(ROOT, 'integrations/research-project/SKILL.md'), 'utf8');
requireThat(/^---\r?\nname: research-project\r?\ndescription: [^\r\n]+\r?\n---/.test(guiEntry) && Buffer.byteLength(guiEntry) <= 8192,
  'Invalid or oversized GUI entry skill');
for (const [name, directory] of Object.entries(loaded.config.skills)) {
  const text = fs.readFileSync(path.join(loaded.config.bundle_root, directory, 'SKILL.md'), 'utf8');
  const match = /^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/.exec(text);
  requireThat(match && match[1] === name, 'Invalid skill frontmatter: ' + name);
  requireThat(match[2].length <= 1024 && text.split('\n').length < 500, 'Skill metadata/body too large');
  for (const link of text.matchAll(/\]\((references\/[^)]+)\)/g)) {
    requireThat(fs.existsSync(confined(loaded.config.bundle_root, path.join(directory, link[1]))), 'Missing skill reference: ' + link[1]);
  }
  skills.push(name);
}
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) :
      entry.name.endsWith('.mjs') ? [path.join(directory, entry.name)] : []);
}
const sources = ['src', 'adapters', 'scripts', 'test', 'benchmarks'].flatMap((d) => sourceFiles(path.join(ROOT, d)));
for (const source of sources) {
  const result = spawnSync(process.execPath, ['--check', source], { encoding: 'utf8', windowsHide: true });
  requireThat(result.status === 0, result.stderr || 'Syntax check failed: ' + source);
}
process.stdout.write(JSON.stringify({ valid: true, syntax_checked_files: sources.length, python_checked_files: pythonChecked, skills,
  example_tasks: [...tasks, 'task-recovery.json'], example_research_records: ['hypothesis.json'],
  external_execution_enabled: loaded.config.execution.allow_external || recoveryConfig.config.execution.allow_external || paperConfig.config.execution.allow_external,
  limitations: ['Static/schema checks only; no model invocation or scientific evaluation.'] }, null, 2) + '\n');
