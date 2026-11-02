import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, id, hash, now, requireThat, clone, writeJSON, artifactCheck } from './util.mjs';
import { checkedAttachment, checkGuiTaskPaths } from './gui-state.mjs';
import { beginAttempt, finishAttempt, dispatchAllowed } from './engine.mjs';
import { prepareWorkspace, executionRoot } from './workspaces.mjs';
import { completeAttempt } from './publication.mjs';
import { saveFinalCheckpoint } from './checkpoints.mjs';
import { isPlanning } from './planning.mjs';

export async function dispatchGuiWork(store, auth, input) {
  const { s, a } = checkedAttachment(store, auth, true);
  requireThat(typeof input.key === 'string' && input.key.length > 0, 'Dispatch key required');
  requireThat(Object.hasOwn(s.tasks, input.task_id), 'Unknown task');
  checkGuiTaskPaths(s, s.tasks[input.task_id].spec);
  const operation_id = 'op_' + hash(a.attachment_id + ':' + input.key).slice(0, 32);
  const digest = hash(JSON.stringify({ task_id: input.task_id, revision: s.tasks[input.task_id].revision }));
  const record = store.transaction((next) => {
    checkedAttachment(store, auth, true);
    const prior = next.gui.operations[operation_id];
    if (prior) { requireThat(prior.digest === digest, 'Operation key reused with changed task/revision'); return { ...prior, duplicate: true }; }
    const op = { operation_id, task_id: input.task_id, task_revision: s.tasks[input.task_id].revision, digest,
      owner: s.owner.id, owner_epoch: s.owner.epoch, attachment_id: a.attachment_id, state: 'submit_intent', created_at: now(),
      dispatch_key: 'gui_' + operation_id, credential: id('operation') };
    next.gui.operations[operation_id] = op; return op;
  });
  if (record.duplicate) return publicOperation(record);
  const directory = path.join(store.directory, 'gui-operations', operation_id);
  let child, out, err;
  try {
    fs.mkdirSync(directory, { recursive: true });
    out = fs.openSync(path.join(directory, 'stdout.log'), 'a'); err = fs.openSync(path.join(directory, 'stderr.log'), 'a');
    // Operation authorization is in the control DB; no GUI credential enters argv.
    child = spawn(process.execPath, [path.join(ROOT, 'scripts/gui-worker.mjs'), s.project.workspace, operation_id, record.credential],
      { shell: false, windowsHide: true, detached: true, stdio: ['ignore', out, err] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    store.transaction((next) => { const op = next.gui.operations[operation_id]; op.pid = child.pid; op.submitted_at = now(); });
    child.unref(); return publicOperation(store.read().gui.operations[operation_id]);
  } catch (error) {
    if (child?.pid) { try { child.kill(); } catch {} }
    store.transaction((next) => { next.gui.operations[operation_id].state = child?.pid ? 'unknown' : 'failed'; next.gui.operations[operation_id].error = error.message; });
    throw error;
  } finally { if (out !== undefined) fs.closeSync(out); if (err !== undefined) fs.closeSync(err); }
}
export function publicOperation(op) { const copy = clone(op); delete copy.credential; return copy; }

export function assessNative(s, a, input) {
  const task = Object.hasOwn(s.tasks, input.task_id) ? s.tasks[input.task_id].spec : null;
  requireThat(task, 'Unknown native task');
  checkGuiTaskPaths(s, task);
  const requirements = input.requirements || {};
  requireThat(Object.keys(requirements).every((k) => ['hard_budget', 'separate_sandbox', 'guaranteed_interrupt'].includes(k)), 'Unknown native requirement');
  const blockers = [];
  const unsupported = (task.capabilities || []).filter((cap) => !['checkpoint', 'checkpoint_boundary'].includes(cap));
  if (unsupported.length) blockers.push('Native observed provider cannot guarantee task capabilities: ' + unsupported.join(', '));
  requireThat(Object.values(requirements).every((v) => typeof v === 'boolean'), 'Native requirement flags must be boolean');
  if (Object.values(requirements).some(Boolean)) blockers.push('Host-observed route cannot enforce hard budget, separate permissions or guaranteed interrupt');
  if (task.purpose === 'benchmark') blockers.push('Use frozen managed benchmark runner; GUI native benchmark expansion disabled');
  if (task.extension_profile && task.extension_profile !== 'none') blockers.push('Native ambient tool isolation not verified; use scoped managed extension worker');
  const effective = input.effective;
  if (!effective || effective.model !== task.model || (effective.effort ?? null) !== (task.reasoning_effort ?? null)) blockers.push('Host model/effort observation missing or mismatched');
  if (isPlanning(task) && task.model_tier !== 'highest') blockers.push('Planning requires highest tier');
  if (effective?.host !== a.host) blockers.push('Native host differs from attachment');
  const family = s.config.backends[task.backend]?.model_family || ({ 'codex-cli': 'codex', 'codex-app-server': 'codex', 'claude-cli': 'claude', 'agy-cli': 'antigravity' }[s.config.backends[task.backend]?.kind]);
  if (family && family !== a.host) blockers.push('Cross-backend work uses managed route');
  return { eligible: !blockers.length, route: blockers.length ? 'managed' : 'native_observed', blockers,
    coverage: 'Host observations are local adapter attestations, not OS isolation or verified native identity' };
}

export async function prepareNativeWork(store, auth, input) {
  const { s, a } = checkedAttachment(store, auth, true), assessment = assessNative(s, a, input);
  requireThat(assessment.eligible, assessment.blockers.join('; '));
  requireThat(['inline', 'subagent'].includes(input.mode), 'Native mode must be inline or subagent');
  requireThat(typeof input.key === 'string' && input.key.length > 0, 'Native dispatch key required');
  const bindingDigest = hash(JSON.stringify({ mode: input.mode, effective: input.effective, requirements: input.requirements || {} }));
  const started = beginAttempt(store, input.task_id, s.owner.id, s.owner.epoch, 'native_' + a.attachment_id + '_' + input.key);
  if (started.duplicate) {
    requireThat(started.attempt.gui_provider?.attachment_id === a.attachment_id, 'Native attempt ownership mismatch');
    requireThat(started.attempt.gui_provider.binding_digest === bindingDigest, 'Native key reused with changed mode/model/requirements');
    return { attempt_id: started.attempt.attempt_id, duplicate: true, state: started.attempt.observed_state };
  }
  const attemptId = started.attempt.attempt_id;
  try {
    if (started.attempt.workspace) await prepareWorkspace(store, attemptId);
    const next = store.read(), attempt = next.attempts[attemptId];
    checkedAttachment(store, auth, true);
    requireThat(dispatchAllowed(next, attemptId, attempt.runner_token), 'Native preparation interrupted');
    started.context.packet.workspace = executionRoot(next, attempt);
    started.context.packet.control_root = next.project.workspace;
    const file = path.join(store.directory, 'attempts', attemptId, 'native-context.json');
    writeJSON(file, started.context.packet);
    store.transaction((current) => {
      checkedAttachment(store, auth, true);
      requireThat(dispatchAllowed(current, attemptId, attempt.runner_token), 'Native dispatch barrier closed');
      current.attempts[attemptId].gui_provider = { mode: input.mode, attachment_id: a.attachment_id, effective: clone(input.effective),
        binding_digest: bindingDigest, trust: 'host_observed_attestation', phase: 'submit_intent', events: {}, context_file: path.relative(s.project.workspace, file).replaceAll('\\', '/') };
      // From this point onward, absence of a receipt never proves non-dispatch.
      current.attempts[attemptId].observed_state = 'unknown';
      current.tasks[input.task_id].status = 'unknown';
    });
    return { attempt_id: attemptId, workspace: executionRoot(next, attempt), context_file: file, state: 'submit_intent',
      instructions: 'Invoke host-native work exactly once; bind its handle. Lost spawn outcome requires reconciliation, never resubmit.' };
  } catch (error) {
    const current = store.read().attempts[attemptId];
    if (!current.gui_provider) finishAttempt(store, attemptId, { status: 'failed', not_dispatched: true, error: error.message });
    throw error;
  }
}

export async function observeNativeWork(store, auth, input) {
  const { s, a } = checkedAttachment(store, auth, true), attempt = s.attempts[input.attempt_id];
  requireThat(attempt?.gui_provider?.attachment_id === a.attachment_id && attempt.owner_epoch === s.owner.epoch, 'Native ownership mismatch');
  requireThat(typeof input.event_id === 'string' && input.event_id.length && ['running', 'unknown', 'completed', 'failed', 'cancelled'].includes(input.state), 'Native event ID/state required');
  requireThat(!['__proto__', 'constructor', 'prototype'].includes(input.event_id), 'Unsafe event ID');
  const digest = hash(JSON.stringify(input));
  const prior = Object.hasOwn(attempt.gui_provider.events, input.event_id) ? attempt.gui_provider.events[input.event_id] : null;
  if (prior) { requireThat(prior.digest === digest, 'Conflicting native event replay'); if (attempt.settled || input.state !== 'completed') return { duplicate: true, state: attempt.observed_state }; }
  requireThat(!attempt.settled || prior, 'Native attempt already settled');
  requireThat(prior || !['completed', 'failed', 'cancelled'].includes(attempt.gui_provider.phase), 'Terminal observation already recorded; replay that exact event to finish acceptance');
  requireThat(input.state !== 'completed' || input.result?.status === 'completed', 'Completed native work requires a completed result contract');
  requireThat(!input.result || input.state === 'completed', 'Only a completed terminal event may supply a result');
  requireThat(input.state !== 'completed' || attempt.desired_state !== 'cancelled' && s.tasks[attempt.task_id].desired_state !== 'cancelled' && s.desired_state !== 'cancelled', 'Cancelled native work cannot accept completion; report cancelled with termination evidence');
  requireThat(typeof input.handle === 'string' && input.handle.length > 0, 'Exact native handle required');
  requireThat(!attempt.gui_provider.handle || attempt.gui_provider.handle === input.handle, 'Native handle changed');
  if (['completed', 'failed', 'cancelled'].includes(input.state)) {
    requireThat(input.descendants_terminal === true && input.evidence?.length > 0, 'Terminal native event requires descendant coverage and evidence');
    input.evidence.forEach((ref) => artifactCheck(s.project.workspace, ref));
  }
  store.transaction((next) => {
    checkedAttachment(store, auth, true);
    const at = next.attempts[input.attempt_id];
    requireThat(at.owner_epoch === next.owner.epoch && !at.settled, 'Native assignment changed');
    requireThat(input.state !== 'completed' || at.desired_state !== 'cancelled' && next.tasks[at.task_id].desired_state !== 'cancelled' && next.desired_state !== 'cancelled', 'Cancelled native work cannot accept completion');
    at.gui_provider.handle = input.handle;
    at.gui_provider.events[input.event_id] = { digest, at: now(), state: input.state, evidence: input.evidence || [] };
    if (input.result) at.gui_provider.reported_result = clone(input.result);
    at.gui_provider.phase = input.state;
    if (['running', 'unknown'].includes(input.state)) {
      requireThat(input.state !== 'running' || at.desired_state === 'running' && next.desired_state === 'running', 'Native control barrier closed');
      at.observed_state = input.state; next.tasks[at.task_id].status = input.state;
      at.job_refs = [{ job_id: input.handle, kind: 'external', observed_state: input.state, owner_attempt: at.attempt_id }];
    } else at.job_refs = at.job_refs.map((job) => ({ ...job, observed_state: 'stopped', descendants_state: 'verified_terminal', verification_trust: 'host_adapter_attestation' }));
  });
  if (['running', 'unknown'].includes(input.state)) return { state: input.state, result_accepted: false };
  const acceptedResult = input.result ? { ...clone(input.result), usage: { input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_usd: null } } : null;
  let result;
  try {
    result = await completeAttempt(store, input.attempt_id, { status: input.state, result: acceptedResult,
      // Do not treat model-authored usage as authoritative; retain estimated/unknown accounting.
      usage: null, error: input.error || null });
  } catch (error) {
    const current = store.read();
    // The attested provider tree is terminal even when its result is invalid.
    // Pending publication is different: preserve the journal for explicit recovery.
    if (!current.publication && !current.attempts[input.attempt_id].settled)
      finishAttempt(store, input.attempt_id, { status: 'failed', usage: null, error: 'Native result rejected: ' + error.message });
    throw error;
  }
  if (result.result?.validity === 'current' && result.observed_state === 'completed') saveFinalCheckpoint(store, input.attempt_id);
  return { attempt_id: input.attempt_id, state: result.observed_state, result: result.result, accounting: 'estimated/unknown; no authoritative host usage receipt' };
}
