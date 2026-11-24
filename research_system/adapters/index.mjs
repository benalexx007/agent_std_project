import fs from 'node:fs';
import path from 'node:path';
import { ROOT, requireThat } from '../src/util.mjs';

const base = { steer: false, pause: false, resume: false, checkpoint: true, quota_api: false, live_usage: false, native_subagents: false,
  cancel: true, streaming: false, usage: false, external_jobs_verified: false,
  checkpoint_boundary: true, checkpoint_midrun: false, cooperative_yield: false };
export function capabilities(backend) {
  switch (backend.kind) {
    case 'mock': return { ...base, steer: true, streaming: true, usage: true, live_usage: true, external_jobs_verified: true, checkpoint_midrun: true, cooperative_yield: true };
    case 'manual': return { ...base, cancel: true, external_jobs_verified: true };
    case 'codex-cli': return { ...base, streaming: true, usage: true };
    case 'codex-app-server': return { ...base, steer: true, streaming: true, usage: true, live_usage: true, native_input: true, checkpoint_midrun: true, quota_api: true, collect_history: true };
    case 'claude-cli': return { ...base, usage: true };
    case 'agy-cli': return { ...base, usage: true };
    case 'command': return { ...base };
    default: throw new Error('Unknown backend kind: ' + backend.kind);
  }
}
export function invocation(backend, task, context, attempt) {
  const model = task.model ? ['--model', task.model] : [];
  const effort = task.reasoning_effort ? ['-c', 'model_reasoning_effort=' + JSON.stringify(task.reasoning_effort)] : [];
  requireThat(!task.reasoning_effort || ['codex-cli', 'codex-app-server', 'agy-cli', 'command', 'mock'].includes(backend.kind), 'Reasoning effort mapping is not configured for this adapter');
  const sandbox = backend.sandbox || 'read-only';
  switch (backend.kind) {
    case 'mock':
      return { command: process.execPath, args: [path.join(ROOT, 'adapters/mock-worker.mjs')],
        stdin: JSON.stringify({ task, attempt }), ipc: true, protocol: 'result-json' };
    case 'codex-cli':
      // Legacy one-shot route. Native session/control uses the bridge below.
      return { command: backend.command, args: ['exec', '--json', '--skip-git-repo-check', '--sandbox', sandbox, ...model, ...effort, '-'],
        stdin: context.text, protocol: 'codex-jsonl' };
    case 'codex-app-server':
      return { command: process.execPath, args: [path.join(ROOT, 'adapters/codex-worker.mjs')],
        stdin: JSON.stringify({ backend, task, context, attempt }), ipc: true, protocol: 'result-json' };
    case 'claude-cli':
      return { command: backend.command, args: ['-p', '--output-format', 'json', ...model],
        stdin: context.text, protocol: 'claude-json' };
    case 'agy-cli':
      // Current CLI supports one NDJSON user turn followed by stdin EOF; no warm session loop.
      requireThat(!task.reasoning_effort || ['low', 'medium', 'high'].includes(task.reasoning_effort), 'Unsupported Antigravity reasoning effort');
      return { command: backend.command, args: ['--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox',
        ...model, ...(task.reasoning_effort ? ['--effort', task.reasoning_effort] : [])],
        stdin: JSON.stringify({ event: 'user', message: { content: context.text } }) + '\n', protocol: 'agy-jsonl' };
    case 'command': {
      const replacements = { '{{prompt}}': context.text, '{{workspace}}': context.packet.workspace || '',
        '{{attempt_id}}': attempt.attempt_id, '{{model}}': task.model || '', '{{reasoning_effort}}': task.reasoning_effort || '' };
      if (task.model_selection?.source === 'tier') requireThat((backend.args || []).some((a) => a.includes('{{model}}')), 'Routed command needs a {{model}} template');
      if (task.reasoning_effort) requireThat((backend.args || []).some((a) => a.includes('{{reasoning_effort}}')), 'Routed command needs a {{reasoning_effort}} template');
      const args = (backend.args || []).map((value) => {
        for (const [key, replacement] of Object.entries(replacements)) value = value.replaceAll(key, replacement);
        return value;
      });
      return { command: backend.command, args, stdin: context.text, protocol: backend.protocol || 'result-json' };
    }
    default: throw new Error('Backend has no process invocation: ' + backend.kind);
  }
}
function parseObject(text, allowFence = false) {
  let value = text.trim();
  if (allowFence) {
    const match = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(value);
    if (match) value = match[1];
  }
  // Only a whole-message single JSON fence may be normalized; no prose/object extraction.
  const result = JSON.parse(value);
  requireThat(result !== null && typeof result === 'object' && !Array.isArray(result), 'Expected JSON result object');
  return result;
}
function agyEnvelope(stdout) {
  const events = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => parseObject(line));
  const results = events.filter((event) => event.event === 'result');
  requireThat(results.length === 1 && events.at(-1)?.event === 'result', 'Expected one terminal Antigravity result');
  requireThat(!events.some((event) => event.event === 'error'), 'Antigravity stream reported an error');
  const result = results[0].result;
  requireThat(result && typeof result === 'object' && !Array.isArray(result), 'Missing Antigravity result envelope');
  requireThat(result.num_turns === undefined || result.num_turns <= 1, 'Unexpected multiple Antigravity turns');
  return result;
}
export function parseOutput(protocol, stdout) {
  if (protocol === 'agy-jsonl') {
    const envelope = agyEnvelope(stdout);
    requireThat(envelope.status === 'SUCCESS', 'Antigravity reported a failed turn: ' + (envelope.error || envelope.status));
    const result = envelope.structured_output && typeof envelope.structured_output === 'object'
      ? envelope.structured_output : parseObject(envelope.response, true);
    result.usage = usageEvidence(protocol, stdout) || { input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_usd: null };
    return { result, session_id: envelope.conversation_id || null };
  }
  if (protocol === 'codex-jsonl') {
    let final = null;
    let session = null;
    let usage = null;
    for (const line of stdout.trim().split(/\r?\n/).filter(Boolean)) {
      const event = JSON.parse(line);
      requireThat(event.type !== 'turn.failed' && event.type !== 'error', 'Codex reported a failed turn');
      if (event.type === 'thread.started') session = event.thread_id;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') final = event.item.text;
      if (event.type === 'turn.completed') usage = event.usage;
    }
    requireThat(final, 'Missing final Codex agent message');
    const result = parseObject(final, true);
    result.usage = { input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null,
      cached_input_tokens: usage?.cached_input_tokens ?? null, cost_usd: null };
    return { result, session_id: session };
  }
  if (protocol === 'claude-json') {
    const envelope = parseObject(stdout);
    requireThat(!envelope.is_error && (!envelope.subtype || envelope.subtype === 'success'), 'Claude returned an error result');
    const result = typeof envelope.structured_output === 'object' ? envelope.structured_output : parseObject(envelope.result, true);
    const u = envelope.usage || {};
    // Input includes cache reads/writes for comparable total input accounting.
    result.usage = {
      input_tokens: typeof u.input_tokens === 'number' ? u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : null,
      output_tokens: u.output_tokens ?? null, cached_input_tokens: u.cache_read_input_tokens ?? null,
      cost_usd: envelope.total_cost_usd ?? null
    };
    return { result, session_id: envelope.session_id || null };
  }
  const result = parseObject(stdout, protocol === 'text');
  if (protocol === 'text') {
    // A model's self-reported token estimate is not backend telemetry.
    result.usage = { input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_usd: null };
  }
  return { result, session_id: null };
}
export function usageEvidence(protocol, stdout) {
  try {
    let usage, cost = null;
    if (protocol === 'result-json') {
      const envelope = JSON.parse(stdout);
      if (envelope.adapter_failure?.version !== 1 || typeof envelope.adapter_failure?.code !== 'string' || typeof envelope.adapter_failure?.message !== 'string' || !envelope.usage) return null;
      const u = envelope.usage;
      usage = { input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null, cached_input_tokens: u.cached_input_tokens ?? null };
      if (usage.cached_input_tokens !== null && (usage.input_tokens === null || usage.cached_input_tokens > usage.input_tokens)) return null;
      cost = u.cost_usd ?? null;
    } else if (protocol === 'claude-json') {
      const envelope = JSON.parse(stdout);
      const u = envelope.usage;
      if (!u) return null;
      usage = { input_tokens: u.input_tokens === undefined ? null :
        u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        output_tokens: u.output_tokens ?? null, cached_input_tokens: u.cache_read_input_tokens ?? null };
      cost = envelope.total_cost_usd ?? null;
    } else if (protocol === 'agy-jsonl') {
      const u = agyEnvelope(stdout).usage;
      if (!u) return null;
      // One cold turn: terminal counters only; cache/thinking are breakdowns, not extra tokens.
      usage = { input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null,
        cached_input_tokens: u.cache_read_tokens ?? null };
    } else if (protocol === 'codex-jsonl') {
      const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const reported = events.findLast((event) => event.usage)?.usage;
      if (!reported) return null;
      usage = { input_tokens: reported.input_tokens ?? null, output_tokens: reported.output_tokens ?? null,
        cached_input_tokens: reported.cached_input_tokens ?? null };
    } else return null;
    const result = { ...usage, cost_usd: cost };
    for (const value of Object.values(result)) if (value !== null && (!Number.isFinite(value) || value < 0)) return null;
    return result;
  } catch { return null; }
}

// Preflight before process creation. Never invoke a shell to work around a Windows shim.
export function validateInvocation(input, platform = process.platform, environment = process.env) {
  const command = { ...input, args: [...input.args] };
  if (platform !== 'win32') return command;
  const quoted = (arg) => !arg.length || /[\s"]/.test(arg) ? '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"' : arg;
  const checkLength = () => requireThat([command.command, ...command.args].map(quoted).join(' ').length + 1 <= 32767,
    'Windows command line exceeds 32767 characters; use a supported stdin/file transport or narrow context (never truncate it)');
  checkLength();
  requireThat(!/\.(cmd|bat|ps1)$/i.test(command.command), 'Windows shell shim is unsupported with shell=false; configure a native executable or Node command adapter');
  const explicit = path.isAbsolute(command.command) || /[\\/]/.test(command.command);
  const directories = explicit ? [''] : (environment.PATH || environment.Path || '').split(path.delimiter);
  let found = null, shim = false;
  for (const directory of directories) {
    const base = explicit ? path.resolve(command.command) : path.join(directory.replace(/^"|"$/g, ''), command.command);
    for (const candidate of path.extname(base) ? [base] : [base + '.exe', base + '.com', base + '.cmd', base + '.bat', base]) {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      if (/\.(cmd|bat|ps1)$/i.test(candidate)) { shim = true; continue; }
      found = candidate; break;
    }
    if (found) break;
  }
  requireThat(found, shim ? 'Only a Windows shell shim was found; configure its native executable or use Node with a script argument' : 'Native executable not found: ' + command.command);
  command.command = found; checkLength();
  return command;
}
