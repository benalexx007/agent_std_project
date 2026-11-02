import { checkAttemptRef } from './receipts.mjs';
import fs from 'node:fs';
import { artifactCheck, confined, hash } from './util.mjs';
import { currentTaskResult } from './engine.mjs';
import { researchReview } from './research.mjs';

export function verifyArtifacts(state, artifacts) {
  const findings = artifacts.map((ref) => {
    try { return { ...artifactCheck(state.project.workspace, ref), passed: true }; }
    catch (error) { return { path: ref.path, passed: false, error: error.message }; }
  });
  return { passed: findings.every((f) => f.passed), findings };
}
export function checkEvidence(state) {
  const findings = [];
  for (const entry of researchReview(state).records) findings.push({ record_id: entry.record.record_id,
    revision: entry.record.revision, passed: entry.validity.current, reasons: entry.validity.reasons });
  for (const claim of Object.values(state.claims)) {
    const checked = verifyArtifacts(state, [...claim.supporting, ...claim.contradicting]);
    const supported = claim.evaluation_status !== 'supported' || claim.supporting.length > 0;
    const contradicted = claim.evaluation_status !== 'contradicted' || claim.contradicting.length > 0;
    findings.push({ claim_id: claim.claim_id, passed: Boolean(checked.passed && supported && contradicted), artifacts: checked.findings });
  }
  for (const run of Object.values(state.runs)) {
    const checked = verifyArtifacts(state, run.outputs);
    findings.push({ run_id: run.run_id, ...checked });
  }
  return { passed: findings.every((f) => f.passed), findings,
    limitations: ['Verifies existence, hashes and structural links; does not judge scientific support, novelty, citations or statistical validity.'] };
}
export function collectResults(state) {
  const results = Object.values(state.attempts).map((a) => {
    if (!a.result) return { attempt_id: a.attempt_id, task_id: a.task_id, status: a.observed_state, error: a.error || null };
    const checked = { passed: true, findings: [...a.result.artifacts, ...a.result.evidence_refs].map((ref) => {
      try { return { ...ref, passed: true, snapshot: checkAttemptRef(state, a, ref) }; }
      catch (error) { return { ...ref, passed: false, error: error.message }; }
    }) };
    checked.passed = checked.findings.every((r) => r.passed);
    const t = state.tasks[a.task_id];
    const inputsCurrent = (a.input_refs || []).every((ref) => {
      try { return hash(fs.readFileSync(confined(state.project.workspace, ref.path))) === ref.sha256; } catch { return false; }
    });
    const current = checked.passed && inputsCurrent && a.task_revision === t.revision && a.result.validity === 'current' &&
      currentTaskResult(state, a.task_id);
    return { attempt_id: a.attempt_id, task_id: a.task_id, status: a.result.status,
      validity: current ? 'current' : 'stale_or_changed', result: a.result, artifact_checks: checked };
  });
  return { results, research: researchReview(state), usage: state.usage, limitations: ['Task completion is a transport/check result, not a scientific verdict.'] };
}
