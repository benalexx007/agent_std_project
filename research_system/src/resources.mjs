import { clone, now, requireThat } from './util.mjs';
import { contract } from './schema.mjs';

export const EMPTY_USAGE = () => ({ known_tokens: 0, estimated_tokens: 0, known_cost_usd: 0, estimated_cost_usd: 0 });
export function resourceDefaults(config) {
  config.budget_reserves ||= { orchestration_tokens: 0, verification_tokens: 0, recovery_tokens: 0, cost_usd: 0 };
  config.checkpoint_policy ||= { lease_ms: 30000 };
  config.recovery_policy ||= { automatic: false, candidates: [], max_same_backend_retries: 1, max_transfers: 2,
    max_segments_per_unit: 4, cooldown_ms: 1000 };
  config.recovery_policy.max_no_progress_recoveries ??= 1;
  config.work_allocation ||= { min_history_samples: 5, quantile: 0.9, max_units_per_task: 32 };
  config.quota_pools ||= {};
  return config;
}
export function initialPools(config) {
  return Object.fromEntries(Object.entries(config.quota_pools || {}).map(([key, p]) => [key, {
    definition: clone(p), snapshot: null, usage: EMPTY_USAGE(), cooldown_until: null, failures: 0
  }]));
}
export function protectedReserve(config, recovery = false) {
  const b = config.budget_reserves;
  return { tokens: b.orchestration_tokens + b.verification_tokens + (recovery ? 0 : b.recovery_tokens), cost_usd: b.cost_usd };
}
export function estimateUnit(unit, state, backendName, task) {
  const e = unit.spec.estimate;
  const configured = e.work_tokens + e.validation_tokens + e.checkpoint_tokens + e.margin_tokens;
  const samples = state && unit.spec.estimate_key ? Object.values(state.attempts).filter((a) => {
    const previous = state.work_units[a.task_id + '/' + a.work_unit_id];
    return a.backend === backendName && a.usage_basis?.tokens === 'reported' &&
      a.effective_config.model === (backendName === task.spec.backend ? task.spec.model : state.config.backends[backendName].model ?? null) &&
      (a.effective_config.reasoning_effort ?? null) === (backendName === task.spec.backend ? task.spec.reasoning_effort ?? null : state.config.backends[backendName].reasoning_effort ?? null) &&
      a.effective_config.role === task.spec.role && previous?.spec.estimate_key === unit.spec.estimate_key;
  }).map((a) => a.accounted_tokens).sort((a, b) => a - b) : [];
  const policy = state?.config.work_allocation;
  const calibrated = policy && samples.length >= policy.min_history_samples;
  const historical = calibrated ? samples[Math.ceil(samples.length * policy.quantile) - 1] + e.checkpoint_tokens + e.margin_tokens : 0;
  return { tokens: Math.max(configured, historical), cost_usd: e.cost_usd,
    basis: calibrated ? 'historical_quantile_plus_reserve' : 'configured_estimate', samples: samples.length };
}
export function poolIds(config, backend) { return config.backends[backend]?.quota_pool_ids || []; }
export function outstanding(state, filter = () => true) {
  return Object.values(state.attempts).filter((a) => !a.settled && filter(a)).reduce((s, a) => ({
    tokens: s.tokens + a.reservation_tokens, cost_usd: s.cost_usd + a.reservation_cost_usd
  }), { tokens: 0, cost_usd: 0 });
}
function usageTotal(usage) {
  return { tokens: usage.known_tokens + usage.estimated_tokens, cost_usd: usage.known_cost_usd + usage.estimated_cost_usd };
}
export function budgetAdmission(state, task, unit, backend, context, recovering = false) {
  const estimate = estimateUnit(unit, state, backend, task), held = outstanding(state), spent = usageTotal(state.usage);
  const backendConfig = state.config.backends[backend];
  const inputEstimate = context.tokenizer_tokens ?? Math.ceil(context.characters / 2);
  if (backendConfig.kind === 'codex-app-server') {
    estimate.tokens = Math.max(estimate.tokens, inputEstimate + backendConfig.native.input_overhead_tokens + estimate.tokens);
    estimate.basis += '_plus_native_input_floor';
    estimate.input_tokens_estimate = inputEstimate;
    estimate.native_overhead_tokens = backendConfig.native.input_overhead_tokens;
  }
  const reserve = protectedReserve(state.config, recovering), limits = state.config.execution;
  const fail = (code, message, extra = {}) => ({ allowed: false, code, message, estimate, ...extra });
  if (limits.max_tokens !== null && spent.tokens + held.tokens + estimate.tokens + reserve.tokens > limits.max_tokens) return fail('project_budget', 'Project token budget/reservations exceeded');
  if (limits.max_cost_usd !== null && spent.cost_usd + held.cost_usd + estimate.cost_usd + reserve.cost_usd > limits.max_cost_usd) return fail('project_budget', 'Project cost budget/reservations exceeded');
  const previous = task.attempts.map((aid) => state.attempts[aid]);
  const taskCost = previous.reduce((s, a) => s + (a.accounted_tokens ?? a.reservation_tokens), 0);
  if (task.spec.budget.max_total_tokens !== undefined && taskCost + estimate.tokens > task.spec.budget.max_total_tokens) return fail('task_budget', 'Task total token budget exhausted');
  // Chars are a labeled estimate, never an exact tokenizer count.
  if (backendConfig.context_window_tokens !== undefined &&
      inputEstimate + unit.spec.estimate.context_growth_tokens + unit.spec.estimate.checkpoint_tokens + unit.spec.estimate.margin_tokens > backendConfig.context_window_tokens) {
    return fail('context_capacity', 'Next unit does not fit estimated context headroom');
  }
  const warnings = [];
  for (const poolId of poolIds(state.config, backend)) {
    const pool = state.pools[poolId];
    requireThat(pool, 'Unknown quota pool: ' + poolId);
    const inFlight = Object.values(state.attempts).filter((a) => !a.settled && a.quota_pool_ids?.includes(poolId));
    if (inFlight.length >= pool.definition.max_concurrent) return fail('pool_concurrency', 'Quota pool concurrency limit reached', { pool_id: poolId });
    if (pool.cooldown_until && Date.parse(pool.cooldown_until) > Date.now()) return fail('pool_cooldown', 'Quota pool is in cooldown', { pool_id: poolId, retry_at: pool.cooldown_until });
    const snapshot = pool.snapshot;
    const stale = !snapshot || Date.now() - Date.parse(snapshot.observed_at) > pool.definition.max_snapshot_age_ms;
    if (!stale && (snapshot.quota_exhausted || snapshot.ordinary_usage_allowed === false)) {
      return fail('quota_exhausted', 'Native quota metadata blocks ordinary usage; no paid fallback', { pool_id: poolId, retry_at: snapshot.resets_at });
    }
    if (stale || snapshot.remaining_tokens === null) {
      if (pool.definition.unknown_policy === 'block') return fail('quota_unknown', 'Quota telemetry is unknown or stale', { pool_id: poolId });
      warnings.push(poolId + ': unknown/stale quota; using local caps only');
    } else {
      const sinceSnapshot = Object.values(state.attempts).filter((a) => a.quota_pool_ids?.includes(poolId) &&
        Date.parse(a.timestamps.created_at) >= Date.parse(snapshot.observed_at) && a.settled)
        .reduce((n, a) => n + (a.accounted_tokens ?? a.reservation_tokens), 0);
      const heldPool = outstanding(state, (a) => a.quota_pool_ids?.includes(poolId));
      if (snapshot.remaining_tokens - sinceSnapshot - heldPool.tokens - estimate.tokens < pool.definition.reserve_tokens) {
        return fail('quota_exhausted', 'Shared quota pool has insufficient headroom', { pool_id: poolId });
      }
    }
  }
  return { allowed: true, estimate, context_tokens_estimate: inputEstimate, precision: context.tokenizer_tokens === null ? 'estimated' : 'tokenizer', warnings };
}
export function updatePool(store, poolId, snapshot) {
  contract('quota-snapshot', snapshot);
  requireThat(Number.isFinite(Date.parse(snapshot.observed_at)), 'Invalid quota observation timestamp');
  requireThat(snapshot.resets_at === null || Number.isFinite(Date.parse(snapshot.resets_at)), 'Invalid quota reset timestamp');
  requireThat((snapshot.remaining_tokens === null) === (snapshot.precision === 'unknown'), 'Quota precision does not match available measurement');
  return store.transaction((state) => {
    const pool = Object.hasOwn(state.pools, poolId) ? state.pools[poolId] : null; requireThat(pool, 'Unknown quota pool');
    requireThat(Date.parse(snapshot.observed_at) <= Date.now() + 1000, 'Quota snapshot is in the future');
    requireThat(!pool.snapshot || Date.parse(snapshot.observed_at) >= Date.parse(pool.snapshot.observed_at), 'Stale quota snapshot update');
    pool.snapshot = clone(snapshot);
    if (snapshot.remaining_tokens > pool.definition.reserve_tokens && pool.last_failure_reason === 'quota_exhausted' &&
      Date.parse(snapshot.observed_at) >= Date.parse(pool.last_failure_at) && (!pool.cooldown_until || Date.parse(pool.cooldown_until) <= Date.now())) pool.failures = 0;
    if (snapshot.remaining_tokens !== null && snapshot.remaining_tokens > 0 &&
      (!pool.last_failure_at || Date.parse(snapshot.observed_at) >= Date.parse(pool.last_failure_at)) &&
      (!pool.cooldown_until || Date.parse(pool.cooldown_until) <= Date.now())) pool.cooldown_until = null;
    return pool;
  });
}
export function settleUsage(state, attempt, usage) {
  if (attempt.settled) return;
  if (usage) attempt.reported_usage = clone(usage);
  const knownTokens = typeof usage?.input_tokens === 'number' && typeof usage?.output_tokens === 'number';
  const tokens = knownTokens ? usage.input_tokens + usage.output_tokens : attempt.reservation_tokens;
  const knownCost = typeof usage?.cost_usd === 'number';
  const cost = knownCost ? usage.cost_usd : attempt.reservation_cost_usd;
  const account = (ledger) => {
    ledger[knownTokens ? 'known_tokens' : 'estimated_tokens'] += tokens;
    ledger[knownCost ? 'known_cost_usd' : 'estimated_cost_usd'] += cost;
  };
  account(state.usage);
  for (const pid of attempt.quota_pool_ids || []) account(state.pools[pid].usage);
  attempt.accounted_tokens = tokens; attempt.accounted_cost_usd = cost;
  attempt.settled = true;
  attempt.usage_basis = { tokens: knownTokens ? 'reported' : 'reservation_estimate', cost: knownCost ? 'reported' : 'reservation_estimate' };
}
export function recordTelemetry(store, attemptId, update) {
  contract('telemetry', update);
  return store.transaction((state) => {
    const a = state.attempts[attemptId]; requireThat(a && !a.settled, 'No active attempt for telemetry');
    requireThat(!a.telemetry_ids?.includes(update.event_id), 'Duplicate telemetry event');
    if (a.telemetry) requireThat(update.sequence > a.telemetry.sequence, 'Out-of-order telemetry');
    const old = a.telemetry?.totals || { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    const totals = update.mode === 'delta' ? {
      input_tokens: old.input_tokens + update.input_tokens, output_tokens: old.output_tokens + update.output_tokens,
      cost_usd: old.cost_usd + update.cost_usd
    } : { input_tokens: update.input_tokens, output_tokens: update.output_tokens, cost_usd: update.cost_usd };
    requireThat(totals.input_tokens >= old.input_tokens && totals.output_tokens >= old.output_tokens && totals.cost_usd >= old.cost_usd, 'Cumulative usage decreased; start a new attempt for a reset');
    a.telemetry_ids = [...(a.telemetry_ids || []), update.event_id];
    a.telemetry = { ...clone(update), totals, observed_at: now() };
    a.reservation_tokens = Math.max(a.reservation_tokens, totals.input_tokens + totals.output_tokens);
    a.reservation_cost_usd = Math.max(a.reservation_cost_usd, totals.cost_usd);
    const remaining = Math.max(0, a.reservation_tokens - totals.input_tokens - totals.output_tokens);
    const unit = state.work_units[a.task_id + '/' + a.work_unit_id];
    const needed = (update.next_step_tokens || 0) + unit.spec.estimate.checkpoint_tokens + unit.spec.estimate.margin_tokens;
    if (a.desired_state === 'running' && state.desired_state === 'running' && state.tasks[a.task_id].desired_state === 'running' &&
      (remaining < needed || update.context_headroom_tokens !== null && update.context_headroom_tokens < needed)) {
      a.desired_state = 'yielding'; a.yield_reason = 'resource_headroom'; unit.status = 'yielding';
    }
    return a.telemetry;
  });
}
