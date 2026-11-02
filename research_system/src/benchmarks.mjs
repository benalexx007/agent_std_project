import { contract } from './schema.mjs';
import { artifactCheck, clone, hash, now, requireThat } from './util.mjs';
import fs from 'node:fs';
import { ROOT, confined, readJSON } from './util.mjs';

function checkOwner(s, owner, epoch) {
  requireThat(owner === s.owner.id && Number(epoch) === s.owner.epoch, 'Stale benchmark owner/epoch');
}
function fingerprint(s, taskIds) {
  return hash(JSON.stringify({ config_hash: s.config_hash, bundle: s.improvements?.active || null,
    tasks: taskIds.map((tid) => s.tasks[tid]?.spec) }));
}
function checkDocuments(s, request) {
  artifactCheck(s.project.workspace, request.protocol);
  if (request.execution_manifest) artifactCheck(s.project.workspace, request.execution_manifest);
  if (request.execution_manifest && request.task_ids.some((tid) => s.config.backends[s.tasks[tid]?.spec.backend]?.kind === 'codex-app-server')) {
    const manifest = readJSON(confined(s.project.workspace, request.execution_manifest.path));
    if (manifest.kind === 'native_l1_execution_manifest') {
      requireThat(manifest.source && Object.keys(manifest.source).length > 0, 'Missing pinned native source');
      for (const [file, expected] of Object.entries(manifest.source)) requireThat(hash(fs.readFileSync(confined(ROOT, file))) === expected, 'Native execution source changed: ' + file);
    }
  }
}
export function requestBenchmark(store, input, owner, epoch) {
  contract('benchmark-request', input);
  return store.transaction((s) => {
    checkOwner(s, owner, epoch);
    s.benchmarks ||= { requests: {} };
    requireThat(!Object.hasOwn(s.benchmarks.requests, input.request_id), 'Benchmark request ID is single-use');
    requireThat(new Set(input.task_ids).size === input.task_ids.length, 'Duplicate benchmark task');
    for (const tid of input.task_ids) {
      const t = s.tasks[tid];
      requireThat(t?.spec.purpose === 'benchmark' && t.spec.benchmark_request_id === input.request_id, 'Benchmark task/request mismatch');
      requireThat(!t.attempts.length, 'Use fresh benchmark tasks for a new request');
    }
    checkDocuments(s, input);
    const request = { ...clone(input), status: 'pending', created_at: now(), owner,
      fingerprint: fingerprint(s, input.task_ids), confirmation: null };
    s.benchmarks.requests[input.request_id] = request;
    return { ...request, next_action: 'Ask the human with the linked protocol, exact scope and limits; do not self-confirm.' };
  });
}
export function confirmBenchmark(store, requestId, confirmation, owner, epoch) {
  requireThat(confirmation && ['approve', 'decline'].includes(confirmation.decision) &&
    typeof confirmation.confirmation_text === 'string' && confirmation.confirmation_text.trim(), 'Explicit human confirmation text is required');
  return store.transaction((s) => {
    checkOwner(s, owner, epoch);
    const r = s.benchmarks?.requests[requestId];
    requireThat(r?.status === 'pending', 'Only a pending benchmark request may be confirmed');
    requireThat(confirmation.protocol_sha256 === r.protocol.sha256 && fingerprint(s, r.task_ids) === r.fingerprint, 'Benchmark scope/protocol changed; ask again with a new request');
    checkDocuments(s, r);
    r.status = confirmation.decision === 'approve' ? 'approved' : 'declined';
    r.confirmation = { decision: confirmation.decision, confirmation_text: confirmation.confirmation_text, at: now(), recorded_by: owner,
      trust: 'trusted_local_operator_attests_to_human_message; not an authentication mechanism' };
    return r;
  });
}
export function benchmarkAdmission(s, task, estimate) {
  if (task.purpose !== 'benchmark') return null;
  const r = s.benchmarks?.requests[task.benchmark_request_id];
  requireThat(r && ['approved', 'started'].includes(r.status), 'Benchmark requires explicit user confirmation with a protocol document for this run');
  requireThat(r.task_ids.includes(task.task_id) && fingerprint(s, r.task_ids) === r.fingerprint, 'Benchmark scope changed; request confirmation again');
  checkDocuments(s, r);
  const attempts = Object.values(s.attempts).filter((a) => a.benchmark_request_id === r.request_id);
  requireThat(attempts.length < r.limits.max_attempts, 'Benchmark attempt limit exhausted');
  const tokens = attempts.reduce((sum, a) => sum + (a.accounted_tokens ?? a.reservation_tokens), 0);
  const cost = attempts.reduce((sum, a) => sum + (a.accounted_cost_usd ?? a.reservation_cost_usd), 0);
  requireThat(tokens + estimate.tokens <= r.limits.max_tokens && cost + estimate.cost_usd <= r.limits.max_cost_usd,
    'Benchmark approved budget exhausted; ask with a new bounded request');
  return r;
}
export function benchmarkFinished(s, attempt) {
  const r = s.benchmarks?.requests[attempt.benchmark_request_id];
  if (r && r.task_ids.every((tid) => s.tasks[tid].status === 'completed') &&
    !Object.values(s.attempts).some((a) => a.benchmark_request_id === r.request_id && (!a.settled ||
      a.job_refs.some((j) => j.kind === 'external' && !['completed', 'failed', 'cancelled'].includes(j.observed_state))))) {
    r.status = 'completed'; r.ended_at = now();
  }
}

export function benchmarkDispatchAllowed(s, attempt) {
  if (!attempt.benchmark_request_id) return true;
  const r = s.benchmarks?.requests[attempt.benchmark_request_id];
  try {
    requireThat(r?.status === 'started' && fingerprint(s, r.task_ids) === r.fingerprint, 'Benchmark changed');
    checkDocuments(s, r);
    return true;
  } catch { return false; }
}

export function supersedeBenchmark(store, requestId, replacement, owner, epoch) {
  requireThat(replacement?.request_id && replacement?.workspace && replacement?.reason, 'Replacement request/workspace/reason required');
  return store.transaction((s) => {
    checkOwner(s, owner, epoch);
    const request = s.benchmarks?.requests[requestId];
    requireThat(request?.status === 'pending', 'Only an unapproved pending request can be superseded');
    requireThat(!Object.values(s.attempts).some((a) => a.benchmark_request_id === requestId), 'Cannot supersede a request with attempts');
    request.status = 'superseded'; request.superseded_at = now(); request.superseded_by = clone(replacement);
    return request;
  });
}
