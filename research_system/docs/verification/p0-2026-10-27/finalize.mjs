// Offline interpretation/redaction only. No processes, network or backend calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, readJSON } from '../../../src/util.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(root, 'result.json');
const report = readJSON(file);
report.quota = Object.fromEntries(['ordinaryUsageAllowed', 'rateLimits', 'rateLimitsByLimitId', 'unavailable', 'reason'].filter((k) => Object.hasOwn(report.quota, k)).map((k) => [k, report.quota[k]]));
report.requirements_metadata = { present: report.requirements !== null && report.requirements !== undefined,
  interpretation: report.requirements == null ? 'No managed requirements returned by this metadata call; runtime permissions remain unverified.' : 'Inspect requirements before activation.' };
report.checks.no_managed_requirement_conflict_observed = { passed: report.requirements == null,
  details: report.requirements_metadata.interpretation };
if (report.requirements != null && !report.blockers.includes('managed_requirements_need_review')) report.blockers.push('managed_requirements_need_review');
const bucket = report.quota.rateLimitsByLimitId?.codex || report.quota.rateLimits;
report.quota_snapshot = bucket ? { observed_at: report.rpc_calls.find((c) => c.method === 'account/rateLimits/read')?.started_at,
  source: 'Native account/rateLimits/read; read-only P0, not imported as a harness token-pool snapshot.',
  five_hour_remaining_percent: bucket.primary?.windowDurationMins === 300 ? Math.max(0, 100 - bucket.primary.usedPercent) : null,
  weekly_remaining_percent: bucket.secondary?.windowDurationMins === 10080 ? Math.max(0, 100 - bucket.secondary.usedPercent) : null,
  ordinary_usage_allowed: report.quota.ordinaryUsageAllowed ?? null,
  five_hour_resets_at: bucket.primary?.resetsAt ? new Date(bucket.primary.resetsAt * 1000).toISOString() : null,
  weekly_resets_at: bucket.secondary?.resetsAt ? new Date(bucket.secondary.resetsAt * 1000).toISOString() : null,
  remaining_tokens: null, hard_cost_cap_verified: false } : { unavailable: true };
report.runtime_policy_verification = { level: 'Static request rendering plus ambient config metadata; no effective thread receipt.',
  ambient_approval_policy: report.ambient_config.approval_policy,
  intended_thread_approval_policy: 'never', intended_sandbox: 'read-only',
  note: 'Ambient on-request/auto_review differs from explicit thread never/user. The driver checks the effective receipt at thread/start before turn/start. P0 does not certify runtime enforcement.' };
report.L1_status = { executed: false, authorized: false, request_frozen: false,
  pending: ['A campaign protocol and execution manifest pinned to the prepared L1 task/config.',
    'An explicit cost accounting basis/estimate; inactive config zero is not a measured price.',
    'Separate human authorization for L1; refresh quota metadata near execution.'] };
report.collector_note = 'Collector quota persistence was narrowed after collection to omit account ID. Finalization is offline; backend observations were not rerun.';
report.verdict = report.blockers.length ? 'P0_BLOCKED' : 'P0_PASS_WITH_EXPLICIT_LIMITATIONS';
report.finalized_at = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
const names = ['report.md', 'check.mjs', 'finalize.mjs', 'result.json', 'static-check.json', 'analysis-context.json', 'native-thread-params-not-submitted.json'];
fs.writeFileSync(path.join(root, 'evidence-manifest.json'), JSON.stringify({ kind: 'P0_evidence_manifest', created_at: report.finalized_at,
  evidence: Object.fromEntries(names.map((name) => [name, hash(fs.readFileSync(path.join(root, name)))])),
  protocol: report.protocol, source_hashes: report.source_hashes }, null, 2) + '\n');
console.log(JSON.stringify({ verdict: report.verdict, quota_snapshot: report.quota_snapshot, checks: Object.keys(report.checks).length, L1: report.L1_status }, null, 2));
