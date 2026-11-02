import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ROOT, hash, fileHash, writeJSON, requireThat, readJSON } from '../src/util.mjs';
import { verifyExtensionEnvironment, closeExtensionObservers } from '../src/extensions.mjs';

const { values: o } = parseArgs({ options: { python: { type: 'string' }, root: { type: 'string' },
  pdftoppm: { type: 'string' }, requirements: { type: 'string' }, wheelhouse: { type: 'string' },
  resolve: { type: 'boolean', default: false }, execute: { type: 'boolean', default: false } } });
requireThat(o.python && path.isAbsolute(o.python), '--python must identify the verified interpreter');
const target = path.resolve(o.root || path.join(ROOT, '.research-environment'));
const command = (exe, args) => {
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, shell: false, timeout: 300000, maxBuffer: 2097152 });
  requireThat(!r.error && r.status === 0, 'Provisioning failed: ' + (r.error?.message || r.stderr || r.stdout));
  return r.stdout;
};
if (!o.execute) {
  process.stdout.write(JSON.stringify({ execute: false, target, packages: ['sympy', 'numpy', 'scipy', 'matplotlib', 'bibtexparser', 'pypdf'],
    limitation: 'Use --execute for project-local package provisioning; this never invokes a model.' }) + '\n');
} else if (fs.existsSync(path.join(target, 'environment.json'))) {
  const existing = readJSON(path.join(target, 'environment.json'));
  verifyExtensionEnvironment(existing, true); closeExtensionObservers();
  requireThat(fileHash(existing.python) === existing.python_sha256, 'Existing environment interpreter changed');
  for (const [ref, digest] of Object.entries(existing.files)) requireThat(fileHash(path.join(target, ref)) === digest, 'Existing environment changed: ' + ref);
  process.stdout.write(JSON.stringify({ provisioned: true, reused: true, environment: path.join(target, 'environment.json') }) + '\n');
} else {
  requireThat(!fs.existsSync(target), 'Refusing to replace an incomplete or unrelated directory');
  const stage = target + '.staging-' + process.pid;
  requireThat(!fs.existsSync(stage), 'Prior staging directory needs operator inspection');
  fs.mkdirSync(stage, { recursive: true });
  const wheels = path.join(stage, 'wheels'), env = path.join(stage, 'venv');
  fs.mkdirSync(wheels);
  const pinned = path.resolve(o.requirements || path.join(ROOT, 'extensions/research/requirements.lock'));
  const selection = fs.existsSync(pinned) && !o.resolve ? ['--require-hashes', '-r', pinned] :
    ['sympy', 'numpy', 'scipy', 'matplotlib', 'bibtexparser', 'pypdf'];
  command(o.python, ['-m', 'pip', '--isolated', '--disable-pip-version-check', 'download',
    ...(o.wheelhouse ? ['--no-index', '--find-links', path.resolve(o.wheelhouse)] : ['--index-url', 'https://pypi.org/simple']),
    '--only-binary=:all:', '--dest', wheels, ...selection]);
  const wheelFiles = fs.readdirSync(wheels).sort();
  requireThat(wheelFiles.length && wheelFiles.every((f) => f.endsWith('.whl')), 'Only reviewed wheel distributions are supported');
  const requirements = wheelFiles.map((f) => {
    const [name, version] = f.split('-');
    return name.replaceAll('_', '-') + '==' + version + ' --hash=sha256:' + fileHash(path.join(wheels, f));
  }).join('\n') + '\n';
  fs.writeFileSync(path.join(stage, 'requirements.lock'), requirements, { flag: 'wx' });
  command(o.python, ['-m', 'venv', env]);
  const relPython = process.platform === 'win32' ? 'venv/Scripts/python.exe' : 'venv/bin/python';
  const python = path.join(stage, relPython);
  command(python, ['-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-index', '--only-binary=:all:',
    '--require-hashes', '--find-links', wheels, '-r', path.join(stage, 'requirements.lock')]);
  const packages = JSON.parse(command(python, ['-I', '-c', 'import importlib.metadata,json; print(json.dumps({n:importlib.metadata.version(n) for n in ["sympy","numpy","scipy","matplotlib","bibtexparser","pypdf"]}))']));
  command(python, ['-I', '-c', 'import sympy,numpy,scipy,matplotlib,bibtexparser,pypdf']);
  const files = {};
  function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name.endsWith('.pyc')) continue;
      const p = path.join(dir, e.name);
      requireThat(!e.isSymbolicLink(), 'Environment symlinks are unsupported by this provisioning route');
      if (e.isDirectory()) collect(p);
      else if (e.isFile()) files[path.relative(stage, p).replaceAll('\\', '/')] = fileHash(p);
    }
  }
  collect(env);
  const poppler = o.pdftoppm ? { command: path.resolve(o.pdftoppm), files: {} } : null;
  if (poppler) {
    requireThat(fs.existsSync(poppler.command), 'Missing Poppler renderer');
    for (const e of fs.readdirSync(path.dirname(poppler.command), { withFileTypes: true }))
      if (e.isFile() && /\.(exe|dll)$/i.test(e.name)) {
        const p = path.join(path.dirname(poppler.command), e.name); poppler.files[p] = fileHash(p);
      }
  }
  const environment = { schema_version: 1, python: path.join(target, relPython), python_sha256: fileHash(python),
    base_python: path.resolve(o.python), base_python_sha256: fileHash(o.python), root: target, packages, files,
    requirements_sha256: hash(requirements), poppler };
  writeJSON(path.join(stage, 'environment.json'), environment);
  fs.renameSync(stage, target);
  process.stdout.write(JSON.stringify({ provisioned: true, reused: false, packages, environment: path.join(target, 'environment.json') }) + '\n');
}
