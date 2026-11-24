import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { sqliteContention, monitorRetryWindow } from './control-monitor.mjs';
import { executionContext } from './context.mjs';
import { now, id, requireThat, writeJSON, hash, clone } from './util.mjs';
import { beginAttempt, dispatchAllowed, finishAttempt, control, validateResult, hasLiveJobs } from './engine.mjs';
import { capabilities, invocation, parseOutput, usageEvidence, validateInvocation } from '../adapters/index.mjs';
import { getUnit, assignmentCurrent, workKey } from './work.mjs';
import { saveCheckpoint, saveFinalCheckpoint } from './checkpoints.mjs';
import { prepareWorkspace, executionRoot, publicationPending } from './workspaces.mjs';
import { completeAttempt } from './publication.mjs';
import { recoverCompletedExtensions } from './extension-recovery.mjs';
import { budgetAdmission } from './resources.mjs';
import { benchmarkAdmission } from './benchmarks.mjs';
import { recordTelemetry } from './resources.mjs';
import { classifyFailure, failureEvidence } from './failures.mjs';
import { planRecovery } from './recovery.mjs';
import { recordNativeBinding, recordNativeUsage, recordNativeInput } from './native-state.mjs';
import { cancelDelegatedTasks } from './native-tools.mjs';

export async function runAttempt(store, taskId, owner, epoch, dispatchKey, options = {}) {
  const started = beginAttempt(store, taskId, owner, epoch, dispatchKey, options);
  if (started.duplicate) return { duplicate: true, attempt: started.attempt };
  const { attempt, task, backend, context } = started;
  const directory = path.join(store.directory, 'attempts', attempt.attempt_id);
  let rootTerminated = false;
  let rootExit = null;
  let terminationJobs = null;
  let child = null, spawnAttempted = false;
  try {
    fs.mkdirSync(directory, { recursive: true });
    if (attempt.workspace) await prepareWorkspace(store, attempt.attempt_id);
    const prepared = store.read().attempts[attempt.attempt_id];
    if (prepared.workspace) {
      executionContext(context, store.read().project.workspace, prepared.workspace, store.read().config.context.max_chars);
      store.transaction((s) => {
        requireThat(dispatchAllowed(s, attempt.attempt_id, attempt.runner_token) && !publicationPending(s), 'Dispatch blocked after workspace preparation');
        requireThat(context.characters <= s.config.context.max_chars, 'Execution context exceeds max_chars');
        const estimateState = clone(s);
        delete estimateState.attempts[attempt.attempt_id];
        const record = estimateState.tasks[taskId];
        record.attempts = record.attempts.filter((aid) => aid !== attempt.attempt_id);
        const admission = budgetAdmission(estimateState, { ...record, spec: task }, getUnit(s, taskId, attempt.work_unit_id),
          task.backend, context, Boolean(options.recoveryId));
        if (!admission.allowed) throw Object.assign(new Error(admission.message), { code: 'RESOURCE_ADMISSION', admission });
        benchmarkAdmission(estimateState, record.spec, admission.estimate);
        Object.assign(s.attempts[attempt.attempt_id], { context_hash: context.sha256, context_characters: context.characters,
          admission, reservation_tokens: admission.estimate.tokens });
      });
      Object.assign(attempt, store.read().attempts[attempt.attempt_id]);
    }
    writeJSON(path.join(directory, 'context.json'), context.packet);
    writeJSON(path.join(directory, 'effective-config.json'), attempt.effective_config);
    if (backend.kind === 'manual') {
      return store.transaction((state) => {
        requireThat(dispatchAllowed(state, attempt.attempt_id, attempt.runner_token), 'Dispatch blocked before manual handoff');
        state.attempts[attempt.attempt_id].observed_state = 'waiting_for_result';
        return { attempt: state.attempts[attempt.attempt_id], context_file: path.join(directory, 'context.json') };
      });
    }
    const command = validateInvocation(invocation(backend, task, context, attempt));
    const caps = capabilities(backend);
    const limits = store.read().config;
    // The final dispatch check and process creation share the same SQLite write lock.
    store.transaction((state) => {
      requireThat(dispatchAllowed(state, attempt.attempt_id, attempt.runner_token), 'Dispatch blocked before spawn');
      spawnAttempted = true;
      child = spawn(command.command, command.args, {
        cwd: executionRoot(state, state.attempts[attempt.attempt_id]), windowsHide: true, shell: false,
        detached: false, stdio: command.ipc ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe']
      });
      const a = state.attempts[attempt.attempt_id];
      a.observed_state = 'running'; a.timestamps.started_at = now();
      a.job_refs = [{ job_id: id('job'), pid: child.pid || null, kind: backend.kind, owner_attempt: attempt.attempt_id,
        observed_state: 'running', child_coverage: caps.external_jobs_verified ? 'verified_no_children' : 'unverified' }];
    });
    const result = await new Promise((resolve, reject) => {
      const finalize = (outcome) => { try { resolve(completeAttempt(store, attempt.attempt_id, outcome)); } catch (error) { reject(error); } };
      let stdout = '';
      const decoder = new StringDecoder('utf8');
      let bytes = 0;
      let failure = null;
      let cancelledAt = null;
      let closed = false;
      let backendFailure = null;
      let yieldSent = false;
      let poll;
      let heartbeatAt = Date.now();
      let contentionAt = null;
      const monitorLog = (event) => fs.appendFileSync(path.join(directory, 'control-monitor.jsonl'), JSON.stringify({ at: now(), ...event }) + '\n');
      const stdoutFile = path.join(directory, 'stdout.log');
      const stderrFile = path.join(directory, 'stderr.log');
      const stdoutLog = fs.createWriteStream(stdoutFile, { highWaterMark: 65536 });
      const stderrLog = fs.createWriteStream(stderrFile, { highWaterMark: 65536 });
      let captureError = null;
      const logError = (error) => { captureError = error; stop('Output capture failed: ' + error.message); };
      stdoutLog.on('error', logError); stderrLog.on('error', logError);
      const stop = (reason) => {
        if (cancelledAt !== null || closed) return;
        cancelledAt = Date.now();
        failure = reason || 'Cancellation requested';
        if (backend.kind === 'codex-app-server') {
          cancelDelegatedTasks(store, attempt.attempt_id, failure);
          if (child.connected) child.send({ action: 'cancel' });
        } else child.kill('SIGTERM');
      };
      const onSignal = () => {
        control(store, { event_id: id('signal'), action: 'cancel', target: taskId, expected_revision: task.task_revision,
          payload: { reason: 'Runner received interrupt' } });
        stop('Runner received interrupt');
      };
      const cleanup = () => { clearInterval(poll); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); };
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
      const capture = (chunk, log, source, collect) => {
        bytes += chunk.length;
        if (bytes > limits.execution.max_output_bytes) { stop('Output exceeded max_output_bytes'); return; }
        try {
          if (!log.write(chunk)) { source.pause(); log.once('drain', () => source.resume()); }
          if (collect) stdout += decoder.write(chunk);
        }
        catch (error) { stop('Output capture failed: ' + error.message); }
      };
      child.stdout.on('data', (chunk) => capture(chunk, stdoutLog, child.stdout, true));
      child.stderr.on('data', (chunk) => capture(chunk, stderrLog, child.stderr, false));
      child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') failure = error.message; });
      if (command.ipc) child.on('message', (message) => {
        try {
          if (message.kind === 'native_binding') {
            try { recordNativeBinding(store, attempt.attempt_id, message.binding); child.send({ reply_to: 'binding', value: true }); }
            catch (error) { if (child.connected) child.send({ reply_to: 'binding', error: error.message }); }
            return;
          }
          if (message.kind === 'native_usage') { recordNativeUsage(store, attempt.attempt_id, message.usage); return; }
          if (message.kind === 'native_input') { recordNativeInput(store, attempt.attempt_id, message.request_id, message.params, message.timeout_ms); return; }
          if (message.kind === 'native_control') {
            store.transaction((s) => {
              const e = s.events[message.event_id];
              if (!e?.affected_attempts.includes(attempt.attempt_id)) return;
              e.deliveries = { ...e.deliveries, [attempt.attempt_id]: message.status };
              e.status = message.status; if (message.error) e.error = message.error;
            }); return;
          }
          if (message.kind === 'yield_request') {
            store.transaction((state) => { state.attempts[attempt.attempt_id].desired_state = 'yielding'; });
            return;
          }
          if (message.kind === 'checkpoint') {
            const checkpoint = saveCheckpoint(store, attempt.attempt_id, message.progress);
            if (child.connected) child.send({ action: 'checkpoint_saved', checkpoint_id: checkpoint.checkpoint_id });
            return;
          }
          if (message.kind === 'telemetry') { recordTelemetry(store, attempt.attempt_id, message.update); return; }
          if (message.kind === 'failure') {
            backendFailure = classifyFailure({ ...message.evidence, pool_ids: attempt.quota_pool_ids });
            return;
          }
        } catch (error) { stop('Checkpoint/telemetry rejected: ' + error.message); return; }
        if (!message?.event_id || message.applied !== true) return;
        store.transaction((state) => {
          const event = state.events[message.event_id];
          if (!event || !event.affected_attempts.includes(attempt.attempt_id)) return;
          event.deliveries = { ...(event.deliveries || {}), [attempt.attempt_id]: 'applied' };
          event.status = event.affected_attempts.every((aid) => event.deliveries[aid] === 'applied') ? 'verified' : 'partial';
        });
      });
      const complete = async (code, signal, spawnError) => {
        if (closed) return;
        closed = true; cleanup();
        rootTerminated = !spawnError || !child.pid;
        rootExit = { exit_code: code, signal: signal || null };
        try {
          await Promise.all([stdoutLog, stderrLog].map((log) => new Promise((done) => { if (log.destroyed) done(); else { log.once('error', done); log.end(done); } })));
          if (rootTerminated) writeJSON(path.join(directory, 'termination.json'), {
            attempt_id: attempt.attempt_id, pid: child.pid || null, at: now(), ...rootExit,
            descendants: caps.external_jobs_verified || !child.pid ? 'none' : 'unknown'
          });
          await recoverCompletedExtensions(store, attempt.attempt_id, owner, epoch);
          stdout += decoder.end();
          let parsed = null;
          let parseError = null;
          try {
            if (captureError) throw captureError;
            if (code === 0 && stdout.trim()) {
              parsed = parseOutput(command.protocol, stdout);
              if (backend.kind === 'codex-app-server' && hasLiveJobs(store.read().attempts[attempt.attempt_id])) throw new Error('Native delegated jobs remain unresolved');
              validateResult(store.read(), attempt, parsed.result);
            } else parseError = spawnError?.message || failure || (stdout.trim() ? 'Worker exit code ' + code : 'Missing result output');
          } catch (error) { parseError = error.message; }
          // A fully validated completed result wins the race with a late cancel request.
          const successfulResult = parsed?.result && !parseError;
          const currentState = store.read().attempts[attempt.attempt_id];
          const structured = failureEvidence(command.protocol, stdout);
          if (!successfulResult && structured?.message) parseError = structured.message;
          const classified = backendFailure || (structured ? classifyFailure({ ...structured, pool_ids: attempt.quota_pool_ids }) : null);
          const status = successfulResult ? (parsed.result.status === 'completed' ? 'completed' : 'failed') :
            backend.kind === 'codex-app-server' && currentState.native?.phase === 'unknown' ? 'unknown' :
            backend.kind === 'codex-app-server' && hasLiveJobs(currentState) ? 'unknown' :
            currentState.desired_state === 'yielding' && currentState.checkpoint_id && caps.external_jobs_verified ? 'yielded' :
            cancelledAt !== null ? (caps.external_jobs_verified ? 'cancelled' : 'unknown') : 'failed';
          const jobs = terminationJobs = store.read().attempts[attempt.attempt_id].job_refs.map((j) => ['external', 'extension'].includes(j.kind) ? j : ({
            ...j, observed_state: 'exited', exit_code: code, signal: signal || null,
            descendants_state: caps.external_jobs_verified ? 'none' : 'unknown'
          }));
          finalize({
            status, result: successfulResult ? parsed.result : null, session_id: parsed?.session_id,
            error: parseError, jobs, usage: currentState.native_usage || usageEvidence(command.protocol, stdout), failure: classified || (!successfulResult ? classifyFailure({
              code: status === 'yielded' ? 'resource_headroom' : failure === 'timeout' ? 'timeout' :
                currentState.desired_state === 'cancelled' ? 'user_cancel' : undefined,
              message: parseError || 'Worker yielded' }) : null)
          });
        } catch (error) { reject(error); }
      };
      child.once('error', (error) => complete(null, null, error));
      child.once('close', (code, signal) => complete(code, signal, null));
      const startedAt = Date.now();
      poll = setInterval(() => {
        const tickAt = Date.now();
        try {
          const snapshot = store.read();
          const current = snapshot.attempts[attempt.attempt_id];
          if (Date.now() - heartbeatAt >= Math.max(20, Math.min(10000, snapshot.config.checkpoint_policy.lease_ms / 3))) {
            store.transaction((state) => {
            const assignment = state.assignments[attempt.assignment_id];
            if (assignmentCurrent(state, state.attempts[attempt.attempt_id]) && assignment.status === 'active') {
              assignment.heartbeat_at = now();
              assignment.lease_expires_at = new Date(Date.now() + state.config.checkpoint_policy.lease_ms).toISOString();
            }
            });
            heartbeatAt = Date.now();
          }
          if (current.desired_state === 'yielding' && !yieldSent) {
            yieldSent = true;
            if (command.ipc && child.connected) child.send({ action: 'yield' });
            else stop('resource_headroom');
          }
          if (current.desired_state === 'cancelled') stop('Cancellation requested');
          if (backend.kind === 'codex-app-server') {
            for (const request of Object.values(current.native_requests || {})) {
              if (request.status !== 'answered' || !child.connected) continue;
              child.send({ reply_to: 'input_' + request.request_id, value: request.response });
              store.transaction((s) => { s.attempts[attempt.attempt_id].native_requests[request.request_id].status = 'delivery_sent'; });
            }
          }
          if (Date.now() - startedAt >= task.budget.timeout_ms) {
            const eventId = 'timeout_' + attempt.attempt_id;
            if (!snapshot.events[eventId]) control(store, {
              event_id: eventId, action: 'cancel', target: taskId, expected_revision: task.task_revision, payload: { reason: 'timeout' }
            });
            stop('timeout');
          }
          if (cancelledAt !== null && Date.now() - cancelledAt >= limits.control.cancel_grace_ms && !closed) {
            if (limits.control.force_kill) child.kill('SIGKILL');
            // Without a confirmed exit, report unknown and leave the reservation in place.
            else {
              closed = true; cleanup(); child.unref();
              child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
              if (child.connected) child.disconnect();
              finalize({ status: 'unknown', error: 'Stop not confirmed; reconciliation required' });
            }
          }
          for (const event of Object.values(snapshot.events)) {
            if (event.action !== 'steer' || !event.affected_attempts.includes(attempt.attempt_id) || event.deliveries?.[attempt.attempt_id]) continue;
            if (caps.steer && child.connected) {
              store.transaction((state) => {
                const e = state.events[event.event_id]; e.deliveries = { ...(e.deliveries || {}), [attempt.attempt_id]: 'sent' };
              });
              child.send({ event_id: event.event_id, action: 'steer', message: event.payload.message });
            } else store.transaction((state) => {
              const e = state.events[event.event_id]; e.deliveries = { ...(e.deliveries || {}), [attempt.attempt_id]: 'deferred_to_next_attempt' };
              e.status = 'deferred';
            });
          }
          if (contentionAt !== null) { monitorLog({ event: 'sqlite_contention_recovered', elapsed_ms: Date.now() - contentionAt }); contentionAt = null; }
        } catch (error) {
          if (sqliteContention(error) && !closed && cancelledAt === null) {
            const first = contentionAt === null;
            contentionAt ??= tickAt;
            const elapsed = Date.now() - contentionAt;
            const retryMs = monitorRetryWindow(limits.checkpoint_policy.lease_ms);
            try { if (first || elapsed >= retryMs) monitorLog({ event: elapsed >= retryMs ? 'sqlite_contention_exhausted' : 'sqlite_contention_retry', code: error.code, errcode: error.errcode, elapsed_ms: elapsed, retry_ms: retryMs }); }
            catch (logFailure) { stop('Control monitor logging failed: ' + logFailure.message); }
            if (elapsed >= retryMs) stop('Control monitor contention limit: ' + error.message);
          } else stop('Control monitor error: ' + error.message);
        } finally {
          // Local deadlines still apply when the database cannot be read.
          if (!closed && Date.now() - startedAt >= task.budget.timeout_ms) stop('timeout');
          if (!closed && cancelledAt !== null && Date.now() - cancelledAt >= limits.control.cancel_grace_ms) {
            if (limits.control.force_kill) child.kill('SIGKILL');
            else {
              closed = true; cleanup(); child.unref();
              child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
              if (child.connected) child.disconnect();
              finalize({ status: 'unknown', error: 'Stop not confirmed; reconciliation required' });
            }
          }
        }
      }, limits.execution.poll_ms);
      child.stdin.end(command.stdin);
    });
    if (result.settled && result.result?.validity === 'current' && result.observed_state === 'completed') {
      saveFinalCheckpoint(store, attempt.attempt_id);
    }
    const finalized = store.read().attempts[attempt.attempt_id];
    writeJSON(path.join(directory, 'attempt.json'), finalized);
    return finalized;
  } catch (error) {
    const snapshot = store.read(), current = snapshot.attempts[attempt.attempt_id];
    if (!spawnAttempted && !current.job_refs.length && current.observed_state === 'dispatching' &&
      (['paused', 'cancelled'].includes(current.desired_state) || snapshot.desired_state !== 'running' ||
        snapshot.tasks[taskId].desired_state !== 'running')) {
      return finishAttempt(store, attempt.attempt_id, { status: 'cancelled', not_dispatched: true, error: 'Control barrier closed before worker dispatch' });
    }
    if (publicationPending(snapshot) && snapshot.publications[snapshot.publication].attempt_id === attempt.attempt_id) {
      return store.transaction((s) => {
        const a = s.attempts[attempt.attempt_id];
        a.observed_state = 'unknown'; a.error = 'Publication recovery required: ' + error.message;
        if (terminationJobs) a.job_refs = terminationJobs;
        s.tasks[a.task_id].status = 'unknown'; s.work_units[workKey(a.task_id, a.work_unit_id)].status = 'unknown';
        s.assignments[a.assignment_id].status = 'unknown';
        return a;
      });
    }
    if (!current.settled) {
      let observedJobs = terminationJobs || current.job_refs;
      if (spawnAttempted && !rootTerminated && child) {
        // A SQLite commit can fail after spawn: rollback cannot undo the OS process.
        child.once('error', () => {});
        child.stdin.destroy(); child.stdout.resume(); child.stderr.resume();
        child.kill('SIGTERM');
        if (!observedJobs.length) observedJobs = [{ job_id: id('uncommitted_spawn'), pid: child.pid || null,
          kind: backend.kind, owner_attempt: attempt.attempt_id, observed_state: 'unknown', child_coverage: 'unverified' }];
      }
      const jobs = observedJobs.map((j) => ['external', 'extension'].includes(j.kind) || !rootTerminated ? j : ({
        ...j, ...rootExit, observed_state: 'exited',
        descendants_state: j.child_coverage === 'verified_no_children' || !j.pid ? 'none' : 'unknown'
      }));
      const unresolved = spawnAttempted && !rootTerminated || jobs.some((j) => ['external', 'extension'].includes(j.kind) ? !['completed', 'failed', 'cancelled', 'stopped'].includes(j.observed_state) :
        !rootTerminated || j.child_coverage === 'unverified' && j.pid !== null);
      return finishAttempt(store, attempt.attempt_id, { status: unresolved ? 'unknown' : 'failed', jobs, error: error.message,
        ...(!spawnAttempted ? { usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cost_usd: 0 } } : {}) });
    }
    throw error;
  }
}
export async function runTask(store, taskId, owner, epoch, dispatchKey, options = {}) {
  let result;
  try { result = await runAttempt(store, taskId, owner, epoch, dispatchKey, options); }
  catch (error) {
    if (error.code !== 'RESOURCE_ADMISSION') throw error;
    store.transaction((state) => { state.tasks[taskId].status = 'waiting_for_capacity'; state.tasks[taskId].capacity_reason = error.message; });
    return { executed: false, remaining_work_status: 'waiting_for_capacity', reason: error.message, admission: error.admission };
  }
  if (result.duplicate) return result;
  let segments = 1;
  while (true) {
    const state = store.read(), record = state.tasks[taskId];
    if (state.owner.id !== owner || state.owner.epoch !== Number(epoch) || state.desired_state !== 'running' || record.desired_state !== 'running') return result;
    if (record.status === 'queued') {
      try { result = await runAttempt(store, taskId, owner, epoch, dispatchKey + '.segment' + segments++); }
      catch (error) {
        if (error.code !== 'RESOURCE_ADMISSION') throw error;
        store.transaction((s) => { s.tasks[taskId].status = 'waiting_for_capacity'; s.tasks[taskId].capacity_reason = error.message; });
        return { ...result, remaining_work_status: 'waiting_for_capacity', reason: error.message };
      }
    } else if (state.config.recovery_policy.automatic && ['failed', 'yielded'].includes(record.status)) {
      const recovery = planRecovery(store, taskId, owner, epoch);
      if (recovery.status !== 'ready') return { ...result, recovery };
      try { result = await runAttempt(store, taskId, owner, epoch, dispatchKey + '.recovery' + segments++, { recoveryId: recovery.recovery_id }); }
      catch (error) {
        if (error.code !== 'RESOURCE_ADMISSION') throw error;
        store.transaction((s) => { s.tasks[taskId].status = 'waiting_for_capacity'; s.tasks[taskId].capacity_reason = error.message; });
        return { ...result, remaining_work_status: 'waiting_for_capacity', reason: error.message };
      }
    } else return result;
  }
}
