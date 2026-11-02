import { now, requireThat, clone } from './util.mjs';
import { dispatchAllowed } from './engine.mjs';

export function recordNativeBinding(store, attemptId, binding) {
  const phases = ['server_started', 'thread_created', 'turn_submit_intent', 'turn_running', 'turn_completed', 'closed', 'unknown'];
  requireThat(phases.includes(binding.phase), 'Unknown native lifecycle phase');
  return store.transaction((s) => {
    const a = s.attempts[attemptId]; requireThat(a && !a.settled, 'No active native assignment');
    if (binding.phase === 'turn_submit_intent') requireThat(dispatchAllowed(s, attemptId, a.runner_token), 'Dispatch blocked before native turn');
    requireThat(!a.native?.thread_id || !binding.thread_id || a.native.thread_id === binding.thread_id, 'Native thread identity changed');
    requireThat(!a.native?.turn_id || !binding.turn_id || a.native.turn_id === binding.turn_id, 'Native turn identity changed');
    a.native = { ...a.native, ...clone(binding), updated_at: now() };
    if (binding.thread_id) a.session_id = binding.thread_id;
    if (['closed', 'unknown', 'turn_completed'].includes(binding.phase)) {
      for (const request of Object.values(a.native_requests || {})) {
        if (request.status === 'pending') request.status = 'closed';
      }
    }
    return a.native;
  });
}

// A session/group counter must be initialized with an observed baseline before reuse.
export function beginNativeUsage(store, attemptId, counter) {
  requireThat(counter && typeof counter.counter_id === 'string' && counter.counter_id &&
    typeof counter.epoch === 'string' && counter.epoch &&
    ['thread_total', 'group_total'].includes(counter.scope) &&
    ['root_only', 'root_and_children'].includes(counter.coverage), 'Invalid native counter identity/scope');
  const baseline = counter.baseline;
  requireThat(baseline && [baseline.input_tokens, baseline.output_tokens, baseline.cached_input_tokens].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    baseline.cached_input_tokens <= baseline.input_tokens, 'Native reuse requires an explicit valid counter baseline');
  return store.transaction((s) => {
    const a = s.attempts[attemptId]; requireThat(a && !a.settled, 'No active native usage assignment');
    requireThat(!a.native_usage_cursor && !a.native_usage, 'Native counter already bound; reconcile resets instead of rebasing silently');
    a.native_usage_cursor = { ...clone(counter), previous: clone(baseline), sequence: null };
    return a.native_usage_cursor;
  });
}

export function recordNativeUsage(store, attemptId, usage, event = {}) {
  requireThat([usage.input_tokens, usage.output_tokens, usage.cached_input_tokens].every((n) => Number.isSafeInteger(n) && n >= 0), 'Invalid native usage');
  requireThat(usage.cached_input_tokens <= usage.input_tokens && usage.cost_usd === null, 'Invalid native usage scope/cost');
  return store.transaction((s) => {
    const a = s.attempts[attemptId]; requireThat(a && !a.settled, 'No active native usage assignment');
    // Current execution only creates fresh threads. Reused counters must call beginNativeUsage first.
    a.native_usage_cursor ||= { counter_id: a.native?.thread_id || attemptId, epoch: 'fresh',
      scope: 'thread_total', coverage: 'root_only', baseline: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 },
      previous: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 }, sequence: null };
    const c = a.native_usage_cursor;
    requireThat(!event.counter_id || event.counter_id === c.counter_id, 'Native counter identity mismatch');
    requireThat(!event.epoch || event.epoch === c.epoch, 'Native counter epoch changed; reconcile before reuse');
    requireThat(!event.scope || event.scope === c.scope, 'Overlapping child/aggregate usage scope');
    if (event.sequence !== undefined) {
      requireThat(Number.isSafeInteger(event.sequence) && event.sequence >= 0, 'Invalid usage sequence');
      if (c.sequence !== null && event.sequence < c.sequence) return a.native_usage || null;
      if (event.sequence === c.sequence) {
        requireThat(['input_tokens', 'output_tokens', 'cached_input_tokens'].every((k) => usage[k] === c.previous[k]), 'Conflicting duplicate usage event');
        return a.native_usage || null;
      }
    }
    requireThat(['input_tokens', 'output_tokens', 'cached_input_tokens'].every((k) => usage[k] >= c.previous[k]),
      'Native cumulative counters decreased; reconcile reset');
    const delta = Object.fromEntries(['input_tokens', 'output_tokens', 'cached_input_tokens'].map((k) => [k, usage[k] - c.baseline[k]]));
    requireThat(delta.cached_input_tokens <= delta.input_tokens, 'Native cached delta exceeds input delta');
    a.native_usage = { ...delta, cost_usd: null };
    c.previous = clone(usage); if (event.sequence !== undefined) c.sequence = event.sequence;
    const observed = delta.input_tokens + delta.output_tokens, allowance = a.reservation_tokens;
    a.reservation_tokens = Math.max(allowance, observed);
    if (observed >= allowance && a.desired_state === 'running') { a.desired_state = 'yielding'; a.yield_reason = 'resource_headroom'; }
    return a.native_usage;
  });
}

export function recordNativeInput(store, attemptId, requestId, params, timeoutMs) {
  requireThat(typeof requestId === 'string' && /^\d+$/.test(requestId), 'Invalid native request ID');
  requireThat(Array.isArray(params.questions) && params.questions.length > 0 && params.questions.length <= 3 &&
    params.questions.every((q) => typeof q.id === 'string' && q.id && typeof q.question === 'string') &&
    new Set(params.questions.map((q) => q.id)).size === params.questions.length, 'Invalid native questions');
  return store.transaction((s) => {
    const a = s.attempts[attemptId];
    requireThat(a && !a.settled && a.native?.thread_id === params.threadId && a.native?.turn_id === params.turnId, 'Native input belongs to another turn');
    a.native_requests ||= {};
    requireThat(Object.keys(a.native_requests).length < 32 && !Object.hasOwn(a.native_requests, requestId), 'Native input limit/duplicate');
    const deadline = Math.min(Date.now() + timeoutMs, Date.parse(a.timestamps.created_at) + a.effective_config.budget.timeout_ms);
    a.native_requests[requestId] = { request_id: requestId, kind: 'user_input', questions: clone(params.questions), status: 'pending',
      created_at: now(), expires_at: new Date(deadline).toISOString() };
    return a.native_requests[requestId];
  });
}

// A local operator action, deliberately absent from the agent's dynamic tool list.
export function answerNativeInput(store, attemptId, requestId, response) {
  return store.transaction((s) => {
    const a = s.attempts[attemptId], r = a?.native_requests?.[requestId];
    requireThat(a && !a.settled && r?.status === 'pending' && Date.now() < Date.parse(r.expires_at) &&
      dispatchAllowed(s, attemptId, a.runner_token), 'Native input is closed, stale or blocked');
    requireThat(response && Object.keys(response).length === 1 && response.answers && typeof response.answers === 'object', 'Expected answers object');
    const keys = Object.keys(response.answers);
    requireThat(keys.length === r.questions.length && keys.every((key) => r.questions.some((q) => q.id === key)), 'Answers must match current question IDs');
    for (const key of keys) {
      const value = response.answers[key];
      requireThat(value && Object.keys(value).length === 1 && Array.isArray(value.answers) && value.answers.length > 0 &&
        value.answers.every((text) => typeof text === 'string' && text.length <= 4096), 'Invalid human answer');
    }
    r.response = clone(response); r.status = 'answered'; r.answered_at = now();
    return r;
  });
}
