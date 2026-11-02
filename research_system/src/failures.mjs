// Use structured adapter evidence first. Plain stderr text is never a quota classifier.
export function classifyFailure({ code, message = '', retry_after_ms = null, pool_ids = [] } = {}) {
  const mapped = {
    ContextWindowExceeded: 'context_capacity', context_limit: 'context_capacity',
    UsageLimitExceeded: 'quota_exhausted', quota_exhausted: 'quota_exhausted',
    error_max_turns: 'turn_limit', error_max_budget_usd: 'attempt_budget',
    max_tokens: 'output_limit', rate_limit: 'rate_limit',
    enforced_spend_limit_reached: 'quota_exhausted', budget_exhausted: 'attempt_budget',
    Unauthorized: 'authorization', unsupported_capability: 'capability',
    connection_lost: 'connection_lost', resource_headroom: 'resource_headroom',
    timeout: 'timeout', user_cancel: 'user_cancel', invalid_result: 'invalid_result'
  };
  const reason = mapped[code] || 'worker_failure';
  return { reason, backend_code: code || null, message, retry_after_ms, pool_ids,
    retryable: ['rate_limit', 'connection_lost', 'timeout'].includes(reason),
    recoverable: ['context_capacity', 'quota_exhausted', 'turn_limit', 'attempt_budget', 'output_limit', 'rate_limit', 'resource_headroom'].includes(reason) };
}
export function failureEvidence(protocol, stdout) {
  try {
    if (protocol === 'codex-jsonl') {
      const events = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const error = events.findLast((e) => e.type === 'turn.failed' || e.type === 'error');
      if (error) return { code: error.error?.codexErrorInfo || error.error?.code || error.code, message: error.error?.message || 'Codex turn failed' };
    } else if (protocol === 'claude-json') {
      const value = JSON.parse(stdout);
      if (value.is_error || value.subtype?.startsWith('error_')) return { code: value.subtype, message: 'Claude SDK result: ' + value.subtype };
    }
  } catch { /* Missing/partial output is deliberately unclassified. */ }
  return null;
}
