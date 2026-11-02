// Deterministic protocol peer, not an LLM or a backend benchmark.
import readline from 'node:readline';
let config, context, timer, pendingTool, step = 0;
const threadId = 'fixture-thread', turnId = 'fixture-turn';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const notification = (method, params) => send({ method, params: { threadId, turnId, ...params } });
const complete = () => {
  const d = context.dispatch, t = context.task;
  const result = { task_id: t.task_id, task_revision: d.task_revision, attempt_id: d.attempt_id, protocol_version: d.protocol_version,
    status: 'completed', summary: 'Native protocol fixture', artifacts: [], evidence_refs: [],
    checks: [{ name: 'fixture', passed: true, details: 'Deterministic protocol only' }], limitations: ['No model inference'], unresolved: [],
    usage: { input_tokens: 99999, output_tokens: 99999, cached_input_tokens: 0, cost_usd: 999 } };
  notification('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 5 } } });
  notification('item/completed', { item: { type: 'agentMessage', text: JSON.stringify(result) } });
  notification('turn/completed', { turn: { id: turnId, status: 'completed' } });
};
const tool = (name, args) => {
  pendingTool = 100 + step;
  send({ id: pendingTool, method: 'item/tool/call', params: { threadId, turnId, tool: name, arguments: args, callId: 'call' + step } });
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (!m.method) {
    if (m.id === 77) return complete();
    if (m.id === pendingTool) {
      if (!m.result?.success) throw new Error(JSON.stringify(m));
      if (step++ === 0) return tool('harness_run_task', { task_id: 'delegated', dispatch_key: 'native-child' });
      return complete();
    }
    return;
  }
  const p = m.params;
  if (m.method === 'initialize') return send({ id: m.id, result: { userAgent: 'fixture' } });
  if (m.method === 'account/rateLimits/read') return send({ id: m.id, result: { rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 1000 }, ordinaryUsageAllowed: true }
  } } });
  if (m.method === 'thread/read') return send({ id: m.id, result: { thread: { id: p.threadId, status: { type: 'notLoaded' },
    turns: p.includeTurns ? [{ id: 'saved-turn', status: 'completed', items: [{ type: 'agentMessage', text: JSON.stringify({
      task_id: 'saved', usage: { input_tokens: 9999, output_tokens: 9999 } }) }] }] : [] } } });
  if (m.method === 'thread/start') {
    config = p;
    if (p.config['agents.enabled'] !== false) throw new Error('Delegation not disabled');
    return send({ id: m.id, result: { thread: { id: threadId }, model: p.model, reasoningEffort: p.config.model_reasoning_effort,
      cwd: p.cwd, approvalPolicy: p.approvalPolicy, sandbox: { type: p.sandbox === 'workspace-write' ? 'workspaceWrite' : 'readOnly' } } });
  }
  if (m.method === 'turn/start') {
    context = JSON.parse(p.input[0].text);
    if (!p.outputSchema || context.result_schema) throw new Error('Schema must use native channel');
    if (context.task.objective.includes('lose reply fixture')) return;
    send({ id: m.id, result: { turn: { id: turnId, status: 'inProgress' } } });
    if (context.task.objective.includes('delegate fixture')) {
      const task = { ...context.task, task_id: 'delegated', role: 'implementer', backend: 'mock', skills: ['research-experiment'],
        dependencies: [], objective: 'Local mock worker', task_class: 'analysis', mock: { duration_ms: 20 } };
      delete task.model_selection; delete task.model; delete task.reasoning_effort; delete task.model_tier;
      return tool('harness_register_task', { task });
    }
    if (context.task.objective.includes('input fixture')) return send({ id: 77, method: 'item/tool/requestUserInput', params: {
      threadId, turnId, questions: [{ id: 'choice', header: 'Fixture', question: 'Choose A or B', options: [{ label: 'A', description: 'Fixture A' }] }] } });
    timer = setTimeout(complete, context.task.objective.includes('wait fixture') ? 5000 : 80);
  }
  if (m.method === 'turn/steer') {
    if (p.expectedTurnId !== turnId) throw new Error('Missing expected turn fence');
    send({ id: m.id, result: { turnId } });
  }
  if (m.method === 'turn/interrupt') {
    clearTimeout(timer); send({ id: m.id, result: {} });
    notification('turn/completed', { turn: { id: turnId, status: 'interrupted' } });
  }
}).on('close', () => { clearTimeout(timer); process.exit(0); });
