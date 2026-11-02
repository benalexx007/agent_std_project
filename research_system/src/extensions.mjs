import fs from 'node:fs';
import path from 'node:path';
import { contract, validate } from './schema.mjs';
import { confined, readJSON, fileHash, hash, requireThat, clone } from './util.mjs';

export const EXTENSION_OPERATIONS = Object.freeze({
  'scholarly.arxiv': { provider: 'arxiv', network: true },
  'scholarly.openalex': { provider: 'openalex', network: true },
  'scholarly.crossref': { provider: 'crossref', network: true },
  'scholarly.download': { provider: 'arxiv', network: true },
  'bibliography.doi': { provider: 'doi', network: true },
  'bibliography.validate': { action: 'bibliography' },
  'math.check': { action: 'math' },
  'statistics.paired': { action: 'paired' },
  'figure.plot': { action: 'figure' },
  'paper.read': { action: 'pdf' },
  'paper.render': { action: 'render' }
});
export const DEFAULT_EXTENSION_LIMITS = Object.freeze({ http_calls: 12, max_records: 50, max_papers: 2,
  max_bytes: 26214400, timeout_ms: 60000, max_calls: 24 });

const verifiedFiles = new Map();
const verifiedTrees = new Map();
export function closeExtensionObservers() {
  for (const tree of verifiedTrees.values()) tree.watcher?.close();
  verifiedTrees.clear(); verifiedFiles.clear();
}
export function verifyExtensionEnvironment(environment, force = false) {
  requireThat(path.isAbsolute(environment.root) && fs.existsSync(environment.root), 'Missing extension environment root');
  if (environment.base_python) requireThat(fileHash(environment.base_python) === environment.base_python_sha256, 'Base Python binding changed');
  const treeKey = environment.root + ':' + hash(JSON.stringify(environment.files || {}));
  let tree = verifiedTrees.get(treeKey);
  if (!tree) {
    tree = { dirty: true, watcher: null };
    try {
      tree.watcher = fs.watch(environment.root, { recursive: true, persistent: false }, () => { tree.dirty = true; });
      tree.watcher.on('error', () => { tree.dirty = true; tree.watcher?.close(); tree.watcher = null; });
    } catch { /* Without observation, revalidate the complete tree on each use. */ }
    verifiedTrees.set(treeKey, tree);
    if (verifiedTrees.size > 8) { const first = verifiedTrees.keys().next().value; verifiedTrees.get(first).watcher?.close(); verifiedTrees.delete(first); }
  }
  if (!force && !tree.dirty && tree.watcher) return;
  if (Object.keys(environment.files || {}).some((p) => p.startsWith('venv/'))) {
    const scan = (directory) => {
      for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
        if (e.name === '__pycache__' || e.name.endsWith('.pyc')) continue;
        const file = path.join(directory, e.name);
        requireThat(!e.isSymbolicLink(), 'Unapproved dependency symlink');
        if (e.isDirectory()) scan(file);
        else requireThat(Object.hasOwn(environment.files, path.relative(environment.root, file).replaceAll('\\', '/')), 'Unpinned file added to dependency environment');
      }
    };
    scan(path.join(environment.root, 'venv'));
  }
  for (const [relative, digest] of Object.entries(environment.files || {})) {
    const file = confined(environment.root, relative), stat = fs.statSync(file);
    const identity = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, digest].join(':');
    if (force || verifiedFiles.get(file) !== identity) {
      requireThat(fileHash(file) === digest, 'Extension dependency changed: ' + relative);
      verifiedFiles.set(file, identity);
    }
  }
  if (environment.base_python) requireThat(fileHash(environment.base_python) === environment.base_python_sha256, 'Base Python binding changed');
  tree.dirty = false;
}

export function extensionDocuments(config) {
  if (!config.extensions) return null;
  const spec = contract('extension-config', config.extensions);
  const root = config.bundle_root;
  const manifest = contract('extension-manifest', readJSON(confined(root, spec.manifest)));
  const lock = contract('extension-lock', readJSON(confined(root, spec.lock)));
  requireThat(fileHash(confined(root, spec.manifest)) === lock.manifest_sha256, 'Extension manifest changed; re-lock and review');
  for (const [relative, digest] of Object.entries(lock.files))
    requireThat(fileHash(confined(root, relative)) === digest, 'Extension package changed: ' + relative);
  for (const operation of Object.keys(manifest.operations)) {
    requireThat(Object.hasOwn(EXTENSION_OPERATIONS, operation), 'Unsupported extension operation: ' + operation);
    const ref = manifest.operations[operation].guidance;
    requireThat(Object.hasOwn(lock.files, ref), 'Unpinned extension guidance: ' + ref);
  }
  for (const profile of Object.values(spec.profiles)) {
    requireThat(new Set(profile.operations).size === profile.operations.length, 'Duplicate extension operation');
    for (const op of profile.operations) requireThat(Object.hasOwn(manifest.operations, op), 'Unknown profile operation: ' + op);
    for (const role of profile.roles) requireThat(Object.hasOwn(config.roles, role) && role !== 'orchestrator', 'Invalid extension role');
    for (const backend of profile.backends) requireThat(Object.hasOwn(config.backends, backend), 'Unknown extension backend');
  }
  const environmentFile = confined(root, lock.environment);
  requireThat(fileHash(environmentFile) === lock.environment_sha256, 'Extension environment binding changed');
  const environment = readJSON(environmentFile);
  requireThat(environment.schema_version === 1 && path.isAbsolute(environment.python) &&
    fileHash(environment.python) === environment.python_sha256, 'Extension interpreter missing or changed');
  verifyExtensionEnvironment(environment);
  const fingerprint = hash(JSON.stringify({ manifest: lock.manifest_sha256, lock: fileHash(confined(root, spec.lock)) }));
  requireThat(!config.extension_fingerprint || config.extension_fingerprint === fingerprint, 'Extension lock changed: review and sync-config while idle');
  return { spec, manifest, lock, environment, fingerprint };
}

export function resolveExtensions(config, task) {
  if (!task.extension_profile || task.extension_profile === 'none') {
    requireThat(!task.extension_scope, 'Extension scope requires an explicit profile'); return null;
  }
  const docs = extensionDocuments(config);
  requireThat(docs && Object.hasOwn(docs.spec.profiles, task.extension_profile), 'Unknown extension profile');
  const profile = docs.spec.profiles[task.extension_profile];
  requireThat(docs.spec.enabled && profile.roles.includes(task.role) && profile.backends.includes(task.backend), 'Extension profile is not enabled for this role/backend');
  requireThat(task.writes_workspace, 'Extension outputs need a writable execution workspace');
  requireThat(config.workspace_policy?.mode === 'snapshot_directory', 'Extensions require an isolated execution workspace');
  const operations = task.extension_scope?.operations || profile.operations;
  requireThat(new Set(operations).size === operations.length && operations.every((op) => profile.operations.includes(op)), 'Task cannot expand extension operations');
  const limits = { ...DEFAULT_EXTENSION_LIMITS, ...profile.limits };
  for (const [key, value] of Object.entries(task.extension_scope?.limits || {})) {
    requireThat(Object.hasOwn(limits, key) && Number.isSafeInteger(value) && value >= 0 && value <= limits[key], 'Task cannot expand extension limits');
    limits[key] = value;
  }
  return { profile: task.extension_profile, fingerprint: docs.fingerprint, operations: clone(operations),
    limits, network: profile.network && operations.some((op) => EXTENSION_OPERATIONS[op].network),
    disclosure: 'harness_paged_resources', native_policy: clone(profile.native_policy),
    environment: { python: docs.environment.python, packages: docs.environment.packages },
    catalog: Object.fromEntries(operations.map((op) => [op, { description: docs.manifest.operations[op].description,
      guidance: docs.manifest.operations[op].guidance }])) };
}

export function checkExtensionBinding(config, attempt) {
  const binding = attempt.extension_binding;
  requireThat(binding && extensionDocuments(config)?.fingerprint === binding.fingerprint, 'Extension binding is missing or stale');
  return binding;
}

export function validateExtensionCall(config, attempt, operation, args) {
  const binding = checkExtensionBinding(config, attempt);
  requireThat(binding.operations.includes(operation), 'Extension operation is not allowed');
  const docs = extensionDocuments(config);
  validate(docs.manifest.operations[operation].input_schema, args);
  requireThat(!EXTENSION_OPERATIONS[operation].network || binding.network, 'Extension network permission is disabled');
  return { binding, docs };
}
