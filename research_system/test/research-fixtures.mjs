import fs from 'node:fs';
import path from 'node:path';
import { hash } from '../src/util.mjs';

export const profile = (format = 'paper') => ({ goal: 'discovery', reasoning_modes: ['hypothesis', 'mathematical', 'experimental', 'verification'], output: { format, language: 'vi' } });
export const hypothesis = (statement = 'Fixture H1 predicts a positive slope') => ({ statement, scope: 'Synthetic fixture only', assumptions: ['x is nonzero'],
  alternatives: ['Fixture H2 predicts a flat response'], prior_work: ['Fixture supplied by the test author, no novelty claim'], origin: 'user',
  predictions: ['A synthetic measurement is positive'], proof_obligations: [], support: 'untested', novelty: 'unassessed', decision: 'Prepare a discriminating check' });
export const derivation = () => ({ statement: 'x/x = 1', definitions: ['x is real'], assumptions: ['x != 0'], steps: ['Divide x by itself'],
  open_obligations: ['The original problem also asks about x=0'], level: 'proof_sketch' });
export const experiment = () => ({ question: 'Separate synthetic slope predictions', mode: 'confirmatory', predictions: ['H1: positive; H2: flat'],
  variables: ['x'], controls: ['fixed measurement function'], measurement: 'synthetic y', analysis: 'Compare sign',
  stop_conditions: ['One fixed fixture observation'], limitations: ['No model or scientific discovery tested'] });
export const evidence = (outcome = 'contradicts') => ({ observation: 'Synthetic y is zero', outcome, prediction_comparison: 'The positive prediction is absent',
  interpretation: 'Fixture evidence, not a scientific finding', limitations: ['Supplied by the test'], next_check: 'Review competing explanations' });
export const review = () => ({ scope: 'Synthetic fixture', reviewer: 'test author', checks: ['Inspect the supplied fixture'], verdict: 'inconclusive',
  findings: [{ location: 'fixture.txt', evidence: 'Zero observation', impact: 'Positive slope claim remains unresolved', certainty: 'high', resolved: false }],
  open_obligations: ['Check the measurement mechanism'] });
export const feedback = () => ({ observation: 'Fixture context omitted a boundary condition', category: 'context', config_hash: 'fixture-config',
  bundle_version: 'original', proposed_change: 'Preserve boundary conditions', review_outcome: 'pending' });
export function record(kind, recordId, data, refs = [], artifacts = [], overrides = {}) {
  return { record_id: recordId, revision: 1, task_id: 'review_scope', task_revision: 1, protocol_version: 'fixture-v1',
    change_reason: 'Synthetic fixture supplied by test author', kind, refs, artifacts, run_ids: [], legacy_claim_ids: [], data, ...overrides };
}
export function rawArtifact(directory, name = 'fixture.txt', text = 'Synthetic fixture evidence; no model invoked.') {
  fs.writeFileSync(path.join(directory, name), text);
  return { path: name, sha256: hash(text) };
}
