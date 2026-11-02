import { clone, now, requireThat, artifactCheck } from './util.mjs';
import { checkOwner } from './engine.mjs';

export function normalizeCodexQuota(response, limitId, observedAt = now()) {
  requireThat(typeof limitId === 'string' && limitId && Number.isFinite(Date.parse(observedAt)), 'Explicit native limit identity/timestamp required');
  const entry = response.rateLimitsByLimitId ? (Object.hasOwn(response.rateLimitsByLimitId, limitId) ? response.rateLimitsByLimitId[limitId] : null) :
    response.rateLimits?.limitId === limitId ? response.rateLimits : null;
  requireThat(entry, 'Native quota limit identity was not returned');
  const windows = [entry.primary, entry.secondary].filter(Boolean).map((w) => {
    requireThat(Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent <= 100 &&
      Number.isSafeInteger(w.windowDurationMins) && w.windowDurationMins > 0 &&
      (w.resetsAt === null || Number.isFinite(w.resetsAt)), 'Invalid native quota window');
    return { used_percent: w.usedPercent, window_minutes: w.windowDurationMins,
      resets_at: w.resetsAt === null ? null : new Date(w.resetsAt * 1000).toISOString() };
  });
  requireThat(windows.length, 'Native quota has no usable windows');
  return { remaining_tokens: null, precision: 'unknown', source: 'codex_app_server_percent_metadata',
    observed_at: observedAt, resets_at: windows.map((w) => w.resets_at).filter(Boolean).sort()[0] || null,
    limit_id: limitId, native_windows: windows,
    quota_exhausted: windows.some((w) => w.used_percent >= 100 && (!w.resets_at || Date.parse(w.resets_at) > Date.parse(observedAt))),
    ...(typeof entry.ordinaryUsageAllowed === 'boolean' ? { ordinary_usage_allowed: entry.ordinaryUsageAllowed } : {}) };
}

// Operator attestation; not an OS/job verifier. It cannot close independently registered remote jobs.
export function verifyResultTermination(store, attemptId, observation, owner, epoch) {
  return store.transaction((s) => {
    checkOwner(s, owner, epoch);
    const a = s.attempts[attemptId];
    requireThat(a?.observed_state === 'unknown' && !a.settled, 'Only unknown attempts need recovered-result termination evidence');
    requireThat(observation.attempt_id === attemptId && observation.evidence?.length && observation.descendants_verified === true,
      'Recovered output needs attempt-scoped termination evidence including descendants');
    observation.evidence.forEach((r) => artifactCheck(s.project.workspace, r));
    requireThat(a.job_refs.every((j) => j.kind !== 'external' || ['completed', 'failed', 'cancelled'].includes(j.observed_state)),
      'Resolve registered external jobs individually before importing output');
    a.job_refs = a.job_refs.map((j) => j.kind === 'external' ? j :
      { ...j, observed_state: 'exited', descendants_state: 'verified_terminal', reconciled_at: now() });
    a.recovered_result_termination = { evidence: clone(observation.evidence), at: now(), owner, epoch: Number(epoch),
      trust: 'operator_attestation_not_automatic_process_verification' };
    return a;
  });
}
