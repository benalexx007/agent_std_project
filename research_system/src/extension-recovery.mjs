import fs from 'node:fs';
import path from 'node:path';
import { requireThat, hash, fileHash, confined, now, clone } from './util.mjs';
import { assignmentCurrent } from './work.mjs';
import { executionRoot, workspacePath } from './workspaces.mjs';
import { validateExtensionCall } from './extensions.mjs';
import { validate } from './schema.mjs';
import { pinFile } from './blobs.mjs';
import { projectDomain } from './domains.mjs';

// A successful durable receipt is written only after the finite local helper exits.
// Recover custody and accounting; never infer parent/other descendant termination.
export async function recoverExtensionReceipt(store, callId, owner, epoch, options = {}) {
  const initial = store.read(), call = initial.extension_calls?.[callId];
  requireThat(initial.owner.id === owner && initial.owner.epoch === Number(epoch), 'Stale extension recovery owner');
  requireThat(call, 'Unknown extension call');
  if (call.status === 'completed' && call.receipt_recovery) return clone(call);
  requireThat(call.status === 'running' && ['paper.read', 'paper.render'].includes(call.operation), 'Recovery requires unresolved finite local helper');
  const attempt = initial.attempts[call.attempt_id];
  const current = (s) => {
    const a = s.attempts[call.attempt_id], c = s.extension_calls?.[callId];
    requireThat(s.owner.id === owner && s.owner.epoch === Number(epoch) && a && !a.settled && assignmentCurrent(s, a) &&
      a.owner_epoch === call.owner_epoch && a.task_revision === call.task_revision && a.assignment_generation === call.assignment_generation &&
      c?.status === 'running' && c.payload_sha256 === call.payload_sha256 && c.binding_sha256 === call.binding_sha256 && !s.publication,
    'Stale extension recovery assignment');
    return a;
  };
  current(initial);
  const folder = confined(store.directory, 'extension-work/' + callId);
  requireThat(fs.lstatSync(folder).isDirectory() && !fs.lstatSync(folder).isSymbolicLink(), 'Untrusted helper receipt folder');
  const read = (name) => { const p = confined(folder, name); requireThat(fs.lstatSync(p).isFile() && !fs.lstatSync(p).isSymbolicLink(), 'Untrusted helper evidence'); return p; };
  const receiptFile = read('receipt.json'), receiptHash = fileHash(receiptFile);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8')), input = JSON.parse(fs.readFileSync(read('input.json'), 'utf8'));
  requireThat(receipt.call_id === callId && receipt.operation === call.operation && input.operation === call.operation &&
    receipt.binding_sha256 === call.binding_sha256 && receipt.payload_sha256 === call.payload_sha256 &&
    hash(JSON.stringify({ operation: input.operation, args: input.arguments })) === call.payload_sha256,
  'Helper receipt identity mismatch');
  requireThat(receipt.status === 'completed' && receipt.result_status === 'completed' && !receipt.error &&
    receipt.observation === 'trusted_finite_helper' && receipt.helper_terminal !== false,
  'No successful terminal finite-helper receipt');
  let binding;
  if (options.historicalReceipt === true) {
    requireThat(options.receiptSha256 === receiptHash, 'Historical recovery requires exact receipt digest');
    // Explicitly approved custody repair only. No helper is executed and no grant is changed.
    const config = initial.config, lockFile = confined(config.bundle_root, config.extensions.lock);
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    const manifestFile = confined(config.bundle_root, config.extensions.manifest);
    requireThat(fileHash(manifestFile) === lock.manifest_sha256 &&
      hash(JSON.stringify({ manifest: lock.manifest_sha256, lock: fileHash(lockFile) })) === call.binding_sha256,
    'Historical grant lock changed');
    for (const [ref, digest] of Object.entries(lock.files)) requireThat(fileHash(confined(config.bundle_root, ref)) === digest, 'Historical grant file changed');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    binding = attempt.extension_binding;
    requireThat(binding?.operations.includes(call.operation), 'Historical operation not allowed');
    validate(manifest.operations[call.operation].input_schema, input.arguments);
  } else {
    ({ binding } = validateExtensionCall(initial.config, attempt, call.operation, input.arguments));
  }
  requireThat(binding.fingerprint === call.binding_sha256 && receipt.http_calls === 0, 'Helper binding/accounting mismatch');
  const job = attempt.job_refs.find(j => j.job_id === call.job_id);
  requireThat(job?.kind === 'extension' && job.owner_attempt === attempt.attempt_id, 'Helper job identity mismatch');
  if (job.pid) { let live = true; try { process.kill(job.pid, 0); } catch (e) { if (e.code === 'ESRCH') live = false; else throw e; }
    requireThat(!live, 'Helper PID still live; observe before recovery'); }
  const relative = projectDomain(initial).extension_namespace + '/' + callId;
  requireThat(Array.isArray(receipt.artifacts) && receipt.artifacts.length > 0 && receipt.artifacts.length <= 100, 'Invalid helper receipt artifacts');
  const refs = [], names = new Set();
  for (const ref of receipt.artifacts) {
    const name = path.posix.basename(ref.path);
    requireThat(ref.path === relative + '/' + name && !names.has(name) && name !== 'receipt.json', 'Helper artifact namespace mismatch');
    names.add(name);
    const source = read(name);
    requireThat(fileHash(source) === ref.sha256, 'Helper artifact hash mismatch');
    refs.push({ ...ref, source });
  }
  requireThat(names.has('result.json') && names.has('input.json'), 'Incomplete helper receipt');
  requireThat(JSON.parse(fs.readFileSync(read('result.json'), 'utf8')).status === 'completed', 'Helper result not completed');
  refs.push({ path: relative + '/receipt.json', sha256: receiptHash, source: receiptFile });
  // Pin and materialize verified bytes before acquiring the state write lock.
  const artifacts = [], root = executionRoot(initial, attempt);
  for (const ref of refs) {
    const blob = await pinFile(initial.project.workspace, ref.source, undefined, binding.limits.max_bytes);
    requireThat(blob.sha256 === ref.sha256, 'Helper evidence changed while pinning');
    const target = workspacePath(root, ref.path, false);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.copyFileSync(ref.source, target, fs.constants.COPYFILE_EXCL);
    requireThat(fileHash(target) === ref.sha256, 'Helper materialization conflict');
    artifacts.push({ path: ref.path, sha256: blob.sha256, blob: blob.path, bytes: blob.bytes });
  }
  return store.transaction((s) => {
    const a = current(s), c = s.extension_calls[callId], j = a.job_refs.find(j => j.job_id === c.job_id);
    requireThat(fileHash(receiptFile) === receiptHash && j?.pid === job.pid, 'Helper recovery evidence changed');
    Object.assign(c, { status: 'completed', receipt: { ...receipt, receipt: { path: relative + '/receipt.json', sha256: receiptHash } },
      artifacts, integratable: true, http_calls: 0, usage_precision: 'observed_requests', error: null, closed_at: receipt.completed_at,
      receipt_recovery: { at: now(), owner, owner_epoch: Number(epoch), sha256: receiptHash, basis: 'verified_successful_finite_helper_receipt', validation_mode: options.historicalReceipt ? 'explicit_historical_grant' : 'current_environment' } });
    Object.assign(j, { observed_state: 'completed', child_coverage: 'verified_no_children' });
    return c;
  });
}

export async function recoverCompletedExtensions(store, attemptId, owner, epoch) {
  const calls = Object.values(store.read().extension_calls || {}).filter(c => c.attempt_id === attemptId && c.status === 'running' && ['paper.read', 'paper.render'].includes(c.operation));
  for (const c of calls) {
    const receipt = confined(store.directory, 'extension-work/' + c.call_id + '/receipt.json', false);
    if (fs.existsSync(receipt)) await recoverExtensionReceipt(store, c.call_id, owner, epoch);
  }
}
