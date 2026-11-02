import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { NativeRPC } from './native-rpc.mjs';
import { requireThat, now, hash } from './util.mjs';
import { validateInvocation } from '../adapters/index.mjs';
import { ORCHESTRATOR_TOOLS, WORKER_TOOLS } from './native-tools.mjs';
import { inspectExtensionNativeScope, checkExtensionStartupScope } from './extension-native.mjs';

export function probeCodex(backend) {
  const command = validateInvocation({ command: backend.command, args: [] }).command;
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000, maxBuffer: 65536 });
  requireThat(!result.error && result.status === 0, 'Codex version probe failed: ' + (result.error?.message || result.stderr));
  const version = result.stdout.trim();
  requireThat(version === backend.native.version, 'Codex binary changed; review and pin native.version: ' + version);
  return { command, version, interface: 'app-server-stdio', inference_started: false, checked_at: now(), live_verified: false };
}

export function nativeThreadParams(backend, task, context) {
  const orchestration = task.role === 'orchestrator';
  return { model: task.model, cwd: context.packet.workspace, sandbox: backend.sandbox || 'read-only',
    approvalPolicy: 'never', approvalsReviewer: 'user', allowProviderModelFallback: false, ephemeral: false,
    config: { 'agents.enabled': false, model_reasoning_effort: task.reasoning_effort,
      'features.apps': false, 'features.plugins': false, 'features.memories': false,
      ...(context.packet.extensions ? { 'sandbox_workspace_write.network_access': false, 'sandbox_workspace_write.writable_roots': [] } : {}),
      ...(orchestration ? { 'features.shell_tool': false } : {}) },
    developerInstructions: [context.packet.role_instructions, context.packet.output_contract,
      'Native delegation is disabled. Delegate only through the supplied harness tools. Never confirm a benchmark or enlarge permissions/budgets.',
      orchestration ? 'Use harness_status/read for scoped state and primary evidence. Register and run worker tasks with stable dispatch keys. Do not return completed while delegated jobs are unresolved.' : ''
    ].filter(Boolean).join('\n'),
    dynamicTools: orchestration ? [...ORCHESTRATOR_TOOLS, WORKER_TOOLS.find((t) => t.name === 'harness_checkpoint')] :
      WORKER_TOOLS.filter((t) => t.name !== 'harness_extension' || context.packet.extensions) };
}

// Only a fixed metadata/read operation is allowed; never resume/start a thread or turn.
async function nativeRead(backend, workspace, method, params) {
  requireThat(['thread/read', 'account/rateLimits/read'].includes(method), 'Observer method is not read-only');
  const pin = probeCodex(backend);
  const child = spawn(pin.command, backend.args || ['app-server', '--stdio'], { cwd: workspace,
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((resolve) => { child.once('error', resolve); child.once('close', resolve); });
  child.stderr.resume();
  const rpc = new NativeRPC(child.stdout, child.stdin, { maxFrameBytes: backend.native.max_frame_bytes,
    timeoutMs: backend.native.request_timeout_ms });
  rpc.on('fault', () => {});
  rpc.on('request', (m) => rpc.reject(m.id, 'Read-only observer cannot approve or execute tools'));
  try {
    await rpc.request('initialize', { clientInfo: { name: 'agentic_research_observer', version: '0.6.0' } });
    rpc.notify('initialized');
    return { pin, response: await rpc.request(method, params) };
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    await exit; clearTimeout(timer);
  }
}
export async function inspectCodex(backend, binding, workspace, includeTurns = false) {
  requireThat(binding?.thread_id, 'No recorded native thread to inspect');
  const { pin, response } = await nativeRead(backend, workspace, 'thread/read', { threadId: binding.thread_id, includeTurns });
  requireThat(response.thread?.id === binding.thread_id, 'Observed native identity mismatch');
  return { ...pin, thread_id: binding.thread_id, turn_id: binding.turn_id, native_status: response.thread.status,
    ...(includeTurns ? { turns: response.thread.turns || [] } : {}), inference_started: false, can_release_reservation: false,
    limitation: 'History/terminal metadata does not prove descendants stopped. Reconcile jobs before importing output.' };
}
export async function collectCodex(backend, binding, workspace) {
  requireThat(binding?.turn_id, 'Exact turn identity is required; never guess the latest turn after a lost reply');
  const read = await inspectCodex(backend, binding, workspace, true);
  const turn = read.turns.find((t) => t.id === binding.turn_id);
  requireThat(turn?.status === 'completed', 'Recorded native turn is not durably completed');
  const final = turn.items?.filter((i) => i.type === 'agentMessage' && typeof i.text === 'string').at(-1)?.text;
  requireThat(final, 'No durable final message for the recorded turn');
  const candidate = JSON.parse(final);
  // Discard model-reported counters. Core may already hold authoritative usage separately.
  candidate.usage = { input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_usd: null };
  const { turns, ...metadata } = read;
  return { ...metadata, candidate, accepted: false };
}
export async function readCodexQuota(backend, workspace) {
  const { pin, response } = await nativeRead(backend, workspace, 'account/rateLimits/read', {});
  return { ...pin, response, inference_started: false };
}

export async function executeCodex(payload, hooks = {}) {
  const { backend, task, context, attempt } = payload;
  const pin = probeCodex(backend), options = backend.native;
  const command = validateInvocation({ command: pin.command, args: [
    ...(attempt.extension_binding ? ['-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.memories=false', '-c', 'agents.enabled=false'] : []),
    ...(backend.args || ['app-server', '--stdio'])] });
  const child = spawn(command.command, command.args, { cwd: context.packet.workspace, windowsHide: true, shell: false,
    stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => { child.once('error', (error) => resolve({ error })); child.once('close', (code, signal) => resolve({ code, signal })); });
  const rpc = new NativeRPC(child.stdout, child.stdin, { maxFrameBytes: options.max_frame_bytes || 1048576,
    timeoutMs: options.request_timeout_ms || 30000 });
  let threadId, turnId, lastUsage = null, final = null, terminal = null, fault = null, stopping = false;
  let resolveTerminal;
  const done = new Promise((resolve) => { resolveTerminal = resolve; });
  let turnReady;
  const ready = new Promise((resolve) => { turnReady = resolve; });
  const record = async (binding) => hooks.binding?.({ ...pin, thread_id: threadId || null, turn_id: turnId || null,
    server_pid: child.pid || null, dispatch_key: attempt.dispatch_key, ...binding });
  const stop = async () => {
    if (stopping) return; stopping = true;
    if (threadId && turnId && !terminal) await rpc.request('turn/interrupt', { threadId, turnId });
  };
  const onControl = async (message) => {
    if (message.action === 'cancel' || message.action === 'yield') return stop();
    if (message.action === 'steer') {
      requireThat(threadId && turnId && !terminal, 'No active native turn to steer');
      await rpc.request('turn/steer', { threadId, expectedTurnId: turnId,
        input: [{ type: 'text', text: message.message, text_elements: [] }] });
      hooks.controlAck?.(message.event_id);
    }
  };
  const detachControl = hooks.controls?.((message) => onControl(message).catch((error) => hooks.controlError?.(message.event_id, error.message)));
  rpc.on('fault', (error) => { fault = error; resolveTerminal(); });
  child.stderr.on('data', (chunk) => hooks.diagnostic?.(chunk));
  const requests = new Set();
  rpc.on('request', (message) => {
    const work = (async () => {
      const p = message.params;
      try {
        await ready;
        requireThat(p?.threadId === threadId && (!turnId || p.turnId === turnId), 'Native request identity mismatch');
        if (message.method === 'item/tool/call') {
          requireThat(hooks.tool, 'Dynamic tool is not enabled for this worker');
          const result = await hooks.tool(p.tool, p.arguments, p.callId);
          const text = JSON.stringify(result);
          requireThat(text.length <= 65536, 'Tool result exceeds context bound; narrow selection');
          rpc.respond(message.id, { success: true, contentItems: [{ type: 'inputText', text }] });
        } else if (message.method === 'item/tool/requestUserInput') {
          requireThat(hooks.input, 'No human input channel');
          const answer = await hooks.input(String(message.id), p, options.input_timeout_ms || 120000);
          rpc.respond(message.id, answer);
        } else if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
          rpc.respond(message.id, { decision: 'decline' });
          hooks.notice?.('Permission request declined: no escalation is authorized by this native profile');
        } else if (message.method === 'item/permissions/requestApproval') rpc.respond(message.id, { permissions: {}, scope: 'turn' });
        else rpc.reject(message.id, 'Unsupported native server request');
      } catch (error) {
        if (message.method === 'item/tool/call') rpc.respond(message.id, { success: false, contentItems: [{ type: 'inputText', text: error.message }] });
        else { rpc.reject(message.id, error.message); await stop(); }
      }
    })();
    requests.add(work); work.catch((error) => { fault = error; resolveTerminal(); }).finally(() => requests.delete(work));
  });
  rpc.on('notification', (message) => {
    const p = message.params;
    if (p?.threadId !== threadId || (turnId && p?.turnId && p.turnId !== turnId)) return;
    if (message.method === 'item/completed' && p.item?.type === 'agentMessage') final = p.item.text;
    if (message.method === 'thread/tokenUsage/updated') {
      const u = p.tokenUsage?.total;
      if (u && [u.inputTokens, u.outputTokens, u.cachedInputTokens].every((n) => Number.isFinite(n) && n >= 0)) {
        if (lastUsage && (u.inputTokens < lastUsage.input_tokens || u.outputTokens < lastUsage.output_tokens)) {
          fault = new Error('Native usage counter reset; reconcile before reuse'); resolveTerminal(); return;
        }
        lastUsage = { input_tokens: u.inputTokens, output_tokens: u.outputTokens, cached_input_tokens: u.cachedInputTokens, cost_usd: null };
        hooks.usage?.(lastUsage);
      }
    }
    if (message.method === 'model/rerouted' && p.toModel !== task.model) { fault = new Error('Native model rerouted; requested model policy was not preserved'); void stop(); }
    if (message.method === 'turn/completed') { terminal = p.turn; turnId ||= p.turn.id; resolveTerminal(); }
  });
  try {
    await record({ phase: 'server_started' });
    await rpc.request('initialize', { clientInfo: { name: 'agentic_research_harness', version: '0.6.0' }, capabilities: { experimentalApi: true } });
    rpc.notify('initialized');
    if (attempt.extension_binding) await checkExtensionStartupScope(rpc, context.packet.workspace);
    const params = nativeThreadParams(backend, task, context);
    const started = await rpc.request('thread/start', params);
    threadId = started.thread?.id;
    requireThat(threadId && started.model === task.model && started.reasoningEffort === task.reasoning_effort,
      'Native effective model/effort differs from frozen selection');
    requireThat(started.cwd && path.resolve(started.cwd) === path.resolve(context.packet.workspace) &&
      started.sandbox?.type === (backend.sandbox === 'workspace-write' ? 'workspaceWrite' : 'readOnly') &&
      started.approvalPolicy === 'never', 'Native effective workspace/permissions differ from profile');
    await record({ phase: 'thread_created', effective: { model: started.model, effort: started.reasoningEffort,
      sandbox: started.sandbox, approval_policy: started.approvalPolicy }, prompt_hash: hash(context.text) });
    if (attempt.extension_binding) {
      requireThat(started.sandbox.networkAccess === false && Array.isArray(started.sandbox.writableRoots) &&
        started.sandbox.writableRoots.every((root) => { const relative = path.relative(context.packet.workspace, root); return relative === '' || !relative.startsWith('..') && !path.isAbsolute(relative); }),
      'Extension helper private roots require a scoped writable sandbox with native network disabled');
      const extensionScope = await inspectExtensionNativeScope(rpc, attempt.extension_binding, context.packet.workspace, threadId);
      await record({ phase: 'thread_created', extension_scope: extensionScope });
    }
    // The parent durably records this intent and rechecks its dispatch barrier before ACK.
    await record({ phase: 'turn_submit_intent' });
    const view = { ...context.packet };
    delete view.result_schema; delete view.role_instructions; delete view.output_contract; delete view.control_root;
    if (view.orchestration) { view.orchestration = { ...view.orchestration }; delete view.orchestration.instructions; }
    const turn = await rpc.request('turn/start', { threadId, model: task.model, effort: task.reasoning_effort,
      input: [{ type: 'text', text: JSON.stringify(view), text_elements: [] }], outputSchema: context.packet.result_schema,
      clientUserMessageId: attempt.dispatch_key });
    turnId = turn.turn?.id;
    requireThat(turnId, 'Missing native turn identity');
    await record({ phase: 'turn_running' });
    turnReady();
    await done;
    if (fault) throw fault;
    requireThat(terminal?.id === turnId && terminal.status === 'completed', 'Native turn did not complete: ' + (terminal?.status || 'unknown'));
    requireThat(final, 'Missing native final result');
    const result = JSON.parse(final);
    result.usage = lastUsage || { input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_usd: null };
    await record({ phase: 'turn_completed', terminal_status: terminal.status });
    return { result, session_id: threadId, usage: result.usage };
  } finally {
    turnReady();
    detachControl?.();
    if (!terminal) { try { await stop(); } catch {} }
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 1000);
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited; clearTimeout(timer); clearTimeout(force);
    await record({ phase: terminal ? 'closed' : 'unknown', terminal_status: terminal?.status || null });
    // Do not fabricate completion for delegated dynamic tool requests.
    if (requests.size) hooks.notice?.('Native tool requests unresolved; retain delegated job reservations');
  }
}
