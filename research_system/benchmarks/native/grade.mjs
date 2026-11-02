import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../../src/store.mjs';
import { checkEvidence } from '../../src/artifacts.mjs';
import { currentTaskResult } from '../../src/engine.mjs';

export function gradeNativeAcceptance(workspace) {
  const store = new Store(workspace);
  try {
    const s = store.read(), task = s.tasks.native_transport;
    const attempt = task?.result && s.attempts[task.result.attempt_id];
    let oracle = false;
    try {
      const value = JSON.parse(task.result.summary);
      oracle = Object.keys(value).sort().join(',') === 'count,mean,missing,sum' && value.count === 3 && value.missing === 1 && value.sum === 12 && value.mean === 4;
    } catch {}
    const result = { kind: 'native_transport_acceptance_not_scientific_quality', oracle,
      structural_completion: task?.status === 'completed' && attempt?.settled === true && currentTaskResult(s, 'native_transport'),
      native_terminal: attempt?.native?.terminal_status === 'completed',
      reported_tokens: attempt?.usage_basis?.tokens === 'reported',
      primary_refs: ['primary-spec.md', 'values.csv'].every((p) => task?.result?.evidence_refs.some((r) => r.path === p)),
      evidence: task ? checkEvidence(s) : null };
    return { ...result, passed: oracle && result.structural_completion && result.native_terminal && result.reported_tokens && result.primary_refs && result.evidence?.passed === true };
  } finally { store.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = gradeNativeAcceptance(path.resolve(process.argv[2]));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.passed) process.exitCode = 1;
}
