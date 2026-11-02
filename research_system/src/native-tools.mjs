import fs from 'node:fs';
import { requireThat, confined, hash, id, now, fileHash } from './util.mjs';
import { checkOwner, registerTask, control, hasLiveJobs } from './engine.mjs';
import { assignmentCurrent } from './work.mjs';
import { buildOrchestratorContext } from './context.mjs';
import { runTask } from './runner.mjs';
import { bundleResource } from './improvements.mjs';
import { saveCheckpoint } from './checkpoints.mjs';
import { executionRoot, workspacePath, isolated } from './workspaces.mjs';

import { runExtension } from './extension-runner.mjs';
import { checkExtensionBinding, extensionDocuments } from './extensions.mjs';

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string', minLength: 1 };
export const ORCHESTRATOR_TOOLS = [
  { name: 'harness_status', description: 'Read bounded project state. No model call.', inputSchema: object({ task_ids: { type: 'array', items: string } }, []) },
  { name: 'harness_read', description: 'Read an artifact or bundle with observed full-file hash. For large files use explicit offset_bytes/max_bytes; ranged replies include exact bytes_base64 and a UTF-8 preview.', inputSchema: object({ path: string, root: { type: 'string', enum: ['workspace', 'bundle'] },
    offset_bytes: { type: 'integer', minimum: 0 }, max_bytes: { type: 'integer', minimum: 1, maximum: 16384 } }, ['path', 'root']) },
  { name: 'harness_register_task', description: 'Register a worker task from the canonical task contract. Cannot grant permissions or create another orchestrator.', inputSchema: object({ task: { type: 'object' } }) },
  { name: 'harness_run_task', description: 'Run an owned worker task, subject to authorization, benchmark confirmation, admission and concurrency. Reuse the same key after a lost reply.', inputSchema: object({ task_id: string, dispatch_key: string }) },
  { name: 'harness_control_task', description: 'Steer, pause or cancel a worker owned by this orchestration attempt. This tool cannot approve decisions or change policy.', inputSchema: object({ task_id: string, action: { type: 'string', enum: ['steer', 'pause', 'cancel'] }, message: { type: 'string' } }, ['task_id', 'action']) }
].map((tool) => ({ type: 'function', ...tool }));
export const WORKER_TOOLS = [
  { type: 'function', name: 'harness_extension', description: 'A scoped finite research helper. Omit arguments to inspect its exact input contract; supply arguments to execute. Read large outputs using harness_read.', inputSchema: object({ operation: string, arguments: { type: 'object' } }, ['operation']) },ORCHESTRATOR_TOOLS.find((t) => t.name === 'harness_read'),
  { type: 'function', name: 'harness_checkpoint', description: 'Save bounded progress for this assignment. Include summary, remaining_actions, artifacts, checks and uncertainties; keep assumptions/open obligations in the summary or pinned artifacts. This does not complete the unit.',
    inputSchema: object({ progress: { type: 'object' } }) }];

export function nativeToolHandler(store, parentId) {
  let calls = 0;
  const checked = () => {
    const s = store.read(), a = s.attempts[parentId];
    requireThat(a && !a.settled && assignmentCurrent(s, a) && a.owner_epoch === s.owner.epoch, 'Stale orchestration assignment');
    checkOwner(s, s.owner.id, a.owner_epoch);
    requireThat(['running', 'yielding'].includes(a.desired_state) && s.desired_state === 'running' && s.tasks[a.task_id].desired_state === 'running', 'Orchestration barrier is closed');
    return { s, a };
  };
  const owned = (s, taskId) => {
    requireThat(Object.hasOwn(s.tasks, taskId) && s.tasks[taskId].orchestration_attempt_id === parentId, 'Task is not owned by this orchestration attempt');
  };
  return async (name, args, callId) => {
    const { s, a } = checked();
    requireThat(!a.benchmark_request_id || (['harness_status', 'harness_read', 'harness_checkpoint'].includes(name) || name === 'harness_extension' && a.effective_config.role !== 'orchestrator' && a.extension_binding), 'Benchmark orchestration cannot expand frozen task scope');
    requireThat(++calls <= (a.effective_config.backend.native?.max_tool_calls || 32), 'Native tool-call budget exhausted');
    const definition = [...ORCHESTRATOR_TOOLS, ...WORKER_TOOLS].find((t) => t.name === name);
    requireThat(definition, 'Unknown native tool');
    requireThat(WORKER_TOOLS.some((t) => t.name === name) || a.effective_config.role === 'orchestrator' && a.desired_state === 'running', 'Worker cannot use orchestration tools');
    const { validate } = await import('./schema.mjs');
    validate(definition.inputSchema, args);
    if (name === 'harness_extension') {
      requireThat(a.effective_config.role !== 'orchestrator', 'Delegate extension work to an authorized worker');
      const binding = checkExtensionBinding(s.config, a);
      requireThat(binding.operations.includes(args.operation), 'Extension operation is not allowed');
      if (args.arguments === undefined) return extensionDocuments(s.config).manifest.operations[args.operation];
      return runExtension(store, parentId, callId, args.operation, args.arguments);
    }
    if (name === 'harness_checkpoint') return saveCheckpoint(store, parentId, args.progress);
    if (name === 'harness_status') return buildOrchestratorContext(s, undefined, { taskIds: args.task_ids }).packet;
    if (name === 'harness_read') {
      const file = args.root === 'bundle' ? bundleResource(s.config, s, args.path).file :
        isolated(a) ? workspacePath(executionRoot(s, a), args.path) : confined(s.project.workspace, args.path);
      const stat = fs.statSync(file);
      const paged = args.offset_bytes !== undefined || args.max_bytes !== undefined;
      requireThat(stat.isFile() && (paged || stat.size <= Math.min(s.config.context.max_chars, 65536)),
        'Resource exceeds native read limit; request an explicit byte range');
      if (!paged) {
        const content = fs.readFileSync(file);
        return { path: args.path, root: args.root, sha256: hash(content), content: content.toString('utf8'), checked_at: now() };
      }
      const offset = args.offset_bytes || 0, limit = Math.min(args.max_bytes || 4096, s.config.context.max_chars, 16384);
      requireThat(offset <= stat.size, 'Read offset exceeds file size');
      const before = fileHash(file), content = Buffer.alloc(Math.min(limit, stat.size - offset));
      const fd = fs.openSync(file, 'r'); let size;
      try { size = fs.readSync(fd, content, 0, content.length, offset); } finally { fs.closeSync(fd); }
      requireThat(fileHash(file) === before, 'Resource changed during paginated read; discard prior baseline');
      const bytes = content.subarray(0, size);
      return { path: args.path, root: args.root, sha256: before, offset_bytes: offset, returned_bytes: size,
        total_bytes: stat.size, next_offset_bytes: offset + size < stat.size ? offset + size : null,
        range_sha256: hash(bytes), bytes_base64: bytes.toString('base64'), content: bytes.toString('utf8'),
        content_is_utf8_preview: true, checked_at: now() };
    }
    if (name === 'harness_register_task') {
      requireThat(args.task.role !== 'orchestrator', 'Recursive orchestrator task is disabled');
      requireThat(args.task.task_id !== a.task_id && !args.task.dependencies?.includes(a.task_id), 'Worker cannot depend on its active orchestrator');
      const result = registerTask(store, args.task, {}, { parentAttemptId: parentId });
      return { task_id: result.spec.task_id, status: result.status };
    }
    owned(s, args.task_id);
    if (name === 'harness_control_task') return control(store, { event_id: id('native_control'), action: args.action,
      target: args.task_id, expected_revision: s.tasks[args.task_id].revision, payload: { message: args.message || '' } });
    // Persist the delegated job before starting any worker. A lost bridge keeps it unresolved.
    const jobId = 'delegate_' + hash(parentId + ':' + args.dispatch_key).slice(0, 24);
    store.transaction((next) => {
      const parent = next.attempts[parentId];
      requireThat(parent && !parent.settled && assignmentCurrent(next, parent) && parent.owner_epoch === next.owner.epoch &&
        parent.desired_state === 'running' && next.tasks[parent.task_id].desired_state === 'running' && next.desired_state === 'running', 'Stale delegation intent');
      const prior = parent.job_refs.find((j) => j.job_id === jobId);
      requireThat(!prior || prior.task_id === args.task_id, 'Delegation key reused for another task');
      if (!prior) parent.job_refs.push({ job_id: jobId, kind: 'external', owner_attempt: parentId,
        task_id: args.task_id, call_id: callId, observed_state: 'running' });
    });
    try {
      const result = await runTask(store, args.task_id, s.owner.id, a.owner_epoch, args.dispatch_key);
      const after = store.read(), t = after.tasks[args.task_id];
      const resolved = t.attempts.every((aid) => after.attempts[aid].settled && !hasLiveJobs(after.attempts[aid]));
      store.transaction((next) => {
        const job = next.attempts[parentId].job_refs.find((j) => j.job_id === jobId);
        job.observed_state = resolved ? (t.status === 'completed' ? 'completed' : 'failed') : 'unknown';
      });
      return { task_id: args.task_id, status: t.status, attempt_id: result.attempt_id || result.attempt?.attempt_id,
        result: t.result || null, recovery: result.recovery || null };
    } catch (error) {
      // Failed admission before any worker exists is a known, terminal delegation.
      const after = store.read(), t = after.tasks[args.task_id];
      store.transaction((next) => {
        next.attempts[parentId].job_refs.find((j) => j.job_id === jobId).observed_state =
          t.attempts.every((aid) => after.attempts[aid].settled && !hasLiveJobs(after.attempts[aid])) ? 'failed' : 'unknown';
      });
      throw error;
    }
  };
}

export function cancelDelegatedTasks(store, parentId, reason) {
  const state = store.read();
  for (const t of Object.values(state.tasks).filter((t) => t.orchestration_attempt_id === parentId && !['completed', 'cancelled', 'failed'].includes(t.status))) {
    control(store, { event_id: id('parent_stop'), action: 'cancel', target: t.spec.task_id, payload: { reason } });
  }
}
