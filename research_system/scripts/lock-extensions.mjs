import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, confined, fileHash, writeJSON, readJSON, requireThat } from '../src/util.mjs';

const { values: o } = parseArgs({ options: { environment: { type: 'string', default: '.research-environment/environment.json' } } });
const manifestPath = 'extensions/research/manifest.json', manifest = readJSON(path.join(ROOT, manifestPath));
const environment = confined(ROOT, o.environment);
requireThat(readJSON(environment).schema_version === 1, 'Provision the environment before locking');
const selected = new Set();
function add(directory) {
  for (const e of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
    if (e.name === '__pycache__' || e.name === 'lock.json') continue;
    const relative = directory + '/' + e.name;
    requireThat(!e.isSymbolicLink(), 'Package symlinks are unsupported');
    if (e.isDirectory()) add(relative); else if (/\.(py|json|md|lock)$/.test(e.name)) selected.add(relative);
  }
}
add('extensions/research');
for (const operation of Object.values(manifest.operations)) selected.add(operation.guidance);
const lock = { schema_version: 1, manifest_sha256: fileHash(path.join(ROOT, manifestPath)),
  files: Object.fromEntries([...selected].sort().map((p) => [p, fileHash(confined(ROOT, p))])),
  environment: path.relative(ROOT, environment).replaceAll('\\', '/'), environment_sha256: fileHash(environment) };
writeJSON(path.join(ROOT, 'extensions/research/lock.json'), lock);
process.stdout.write(JSON.stringify({ locked: true, files: selected.size, environment: lock.environment }) + '\n');
