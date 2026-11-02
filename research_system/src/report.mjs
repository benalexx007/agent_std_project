import fs from 'node:fs';
import path from 'node:path';
import { currentTaskResult, reservations } from './engine.mjs';
import { projectDomain } from './domains.mjs';

export function usageReport(state) {
  const byBackend = {};
  for (const attempt of Object.values(state.attempts)) {
    const row = byBackend[attempt.backend] ||= { attempts: 0, reported_input_tokens: 0, reported_output_tokens: 0,
      reported_cached_input_tokens: 0, reported_cost_usd: 0, unknown_token_attempts: 0, unknown_cost_attempts: 0,
      fixture: state.config.backends[attempt.backend]?.kind === 'mock' };
    row.attempts++;
    const usage = attempt.result?.usage || attempt.reported_usage;
    if (usage?.input_tokens !== null && typeof usage?.input_tokens === 'number' && typeof usage?.output_tokens === 'number') {
      row.reported_input_tokens += usage.input_tokens; row.reported_output_tokens += usage.output_tokens;
      row.reported_cached_input_tokens += usage.cached_input_tokens || 0;
    } else row.unknown_token_attempts++;
    if (typeof usage?.cost_usd === 'number') row.reported_cost_usd += usage.cost_usd;
    else row.unknown_cost_attempts++;
  }
  const accepted = Object.values(state.tasks).filter((t) => t.status === 'completed' && currentTaskResult(state, t.spec.task_id)).length;
  const events = Object.values(state.events);
  const decisions = Object.values(state.decisions);
  return {
    usage: state.usage, reservations: reservations(state), by_backend: byBackend,
    gui_accounting: state.gui ? { root_inference: 'unknown/not included in harness worker totals',
      native_usage: 'host-attested observations do not establish authoritative inclusive/exclusive usage',
      precision: 'worker totals are partial project totals; no parent/child counters added together' } : null,
    extensions: { calls: Object.keys(state.extension_calls || {}).length,
      observed_http_requests: Object.values(state.extension_calls || {}).filter((c) => c.status !== 'running' && c.usage_precision === 'observed_requests').reduce((n, c) => n + c.http_calls, 0),
      conservative_http_requests: Object.values(state.extension_calls || {}).filter((c) => c.status !== 'running' && c.usage_precision === 'conservative_envelope').reduce((n, c) => n + c.http_calls, 0),
      unresolved_request_envelopes: Object.values(state.extension_calls || {}).filter((c) => c.status === 'running').reduce((n, c) => n + c.reserved_http_calls, 0),
      cost_usd: null, precision: 'Request counters or conservative envelopes; provider credits/cost are not inferred from token quota.' },
    structurally_accepted_tasks: accepted,
    tokens_per_structurally_accepted_task: accepted ? (state.usage.known_tokens + state.usage.estimated_tokens) / accepted : null,
    estimated_cost_per_structurally_accepted_task: accepted ? (state.usage.known_cost_usd + state.usage.estimated_cost_usd) / accepted : null,
    controls: events.map((e) => ({ event_id: e.event_id, action: e.action, status: e.status,
      received_at: e.received_at, verified_at: e.status === 'verified' ? e.updated_at : null,
      verification_latency_ms: e.status === 'verified' ? Math.max(0, Date.parse(e.updated_at) - Date.parse(e.received_at)) : null })),
    human_decisions: decisions.map((d) => ({ decision_id: d.decision_id, status: d.status,
      elapsed_wait_ms: d.answered_at ? Date.parse(d.answered_at) - Date.parse(d.created_at) : null })),
    resources: {
      reserves: state.config.budget_reserves,
      pools: state.pools,
      estimate_bases: Object.values(state.attempts).map((a) => ({ attempt_id: a.attempt_id, estimate: a.admission?.estimate ?? null })),
      precision: 'Backend telemetry where available; configured/history estimates otherwise'
    },
    recovery: {
      checkpoints: Object.keys(state.checkpoints).length,
      published_manifest_bytes: Object.values(state.checkpoints).reduce((sum, c) => {
        try { return sum + fs.statSync(path.join(state.project.workspace, c.manifest_path)).size; } catch { return sum; }
      }, 0),
      transfers: Object.values(state.work_units).reduce((sum, u) => sum + u.transfers, 0),
      retries: Object.values(state.work_units).reduce((sum, u) => sum + u.retries, 0),
      outcomes: Object.values(state.recoveries).map((r) => ({
        recovery_id: r.recovery_id, status: r.status, outcome: r.outcome || null,
        elapsed_ms: r.completed_at ? Date.parse(r.completed_at) - Date.parse(r.created_at) : null
      }))
    },
    limitations: [
      projectDomain(state).usage_limitation,
      'Fixture usage is synthetic. Unknown usage is retained as unknown; reservations are labeled estimates.',
      'Different providers may tokenize differently; compare quality and actual/estimated cost, not raw token totals alone.',
      'Elapsed decision wait does not measure the human time spent actively reviewing.',
      'No compute-meter integration or agent-quality benchmark is executed by this command.'
    ]
  };
}
