// This file executes model trials ONLY after the already-registered request has human approval.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJSON, writeJSON, hash, requireThat } from '../../src/util.mjs';
import { Store } from '../../src/store.mjs';
import { runTask } from '../../src/runner.mjs';
import { benchmarkAdmission } from '../../src/benchmarks.mjs';
import { artifactCheck } from '../../src/util.mjs';

export function numericChecks(caseId, answer, probe) {
  const c = answer?.calculations || {}, close = (key, value) => ({ key, expected: value, observed: c[key] ?? null,
    passed: typeof c[key] === 'number' && Math.abs(c[key] - value) <= 0.001 });
  if (caseId === 'C1') return Object.entries({ A_pooled:29/110, B_pooled:81/110, A_mild:.9, B_mild:.8, A_severe:.2, B_severe:.1 }).map(([k,v]) => close(k,v));
  if (caseId === 'C2') return Number.isInteger(probe) && probe >= 0 && probe <= 6 ? [close('probe_x', probe), close('probe_y', 2*probe+1+Math.max(0,probe-3)**2)] : [{ key:'probe_selection', passed:false, reason:'Invalid or missing probe' }];
  if (caseId === 'C3') return [close('initial_difference',.25), close('replication_difference',-.05), close('pooled_difference',0)];
  return [close('f_at_2',2), close('g_at_2',4)];
}

// Pure integrity checks, also used by software tests. No worker launch.
export function verifyPreparedCampaign(directory, manifest, request, derived = []) {
  requireThat(manifest.format_version === 2, 'Legacy campaign: prepare a new v2 protocol and ask again');
  requireThat(request?.execution_manifest?.path === 'manifest.json', 'Campaign manifest must be pinned by the permission request');
  artifactCheck(directory, request.execution_manifest);
  artifactCheck(directory, request.protocol);
  requireThat(hash(fs.readFileSync(manifest.backend_executable)) === manifest.backend_executable_sha256, 'Codex executable changed; recheck scope');
  for (const ref of [...manifest.pinned_files, ...derived]) artifactCheck(directory, ref);
  for (const [file,sha] of Object.entries(manifest.source_hashes)) requireThat(hash(fs.readFileSync(path.join(ROOT,file))) === sha, 'Prepared benchmark source changed');
}

// C2 probe belongs to the final planner, never to the preliminary analyst.
export function selectedProbe(prior) { return prior.find((p) => p.phase === 'plan')?.answer?.next_probe; }

// Explicit stage scope; selected full records stay intact and all outputs remain archived.
export function handoffForStage(prior, phase) {
  const required = { plan: ['analysis'], calculate: ['plan'], update: ['plan', 'calculate'], review: ['analysis', 'plan', 'calculate', 'update'] };
  requireThat(Object.hasOwn(required, phase), 'Unknown B01 handoff stage');
  return prior.filter((entry) => required[phase].includes(entry.phase));
}

export async function run(directory) {
  const manifest = readJSON(path.join(directory,'manifest.json'));
  const store = new Store(directory), outputs = [], derived = [], started = Date.now();
  let result;
  try {
    const state = store.read();
    requireThat(state.benchmarks?.requests[manifest.request_id]?.status === 'approved', 'Ask the human with protocol.md and record confirmation before this benchmark execution');
    requireThat(Object.keys(state.attempts).length === 0, 'This campaign runner is single-use; do not rerun a partial campaign without review and new approval');
    verifyPreparedCampaign(directory, manifest, state.benchmarks.requests[manifest.request_id]);
    const cases = readJSON(path.join(directory,'operator-cases.json'));
    const trialOutputs = new Map();
    for (const stage of manifest.stages) {
      requireThat(Date.now()-started <= manifest.campaign_timeout_ms,'Campaign time limit exhausted');
      const prior = trialOutputs.get(stage.trial) || [];
      const writeDerived = (name, value) => {
        const relative = 'trials/'+stage.trial+'/'+name;
        requireThat(!fs.existsSync(path.join(directory,relative)), 'Refusing to overwrite a derived campaign input');
        writeJSON(path.join(directory,relative), value);
        derived.push({ path: relative, sha256: hash(fs.readFileSync(path.join(directory,relative))), created_at: new Date().toISOString(), producer_task_id: prior.at(-1)?.task_id });
        writeJSON(path.join(directory,'derived-inputs.json'),derived);
      };
      if (prior.length) writeDerived(stage.phase === 'plan' ? 'analysis.json' : 'prior-'+stage.phase+'.json',handoffForStage(prior,stage.phase));
      if (stage.phase === 'calculate' && stage.case_id === 'C2') {
        const probe = selectedProbe(prior);
        writeDerived('measurement.json',Number.isInteger(probe) && probe>=0 && probe<=6 ?
          { selected_x:probe, observed_y:2*probe+1+Math.max(0,probe-3)**2 } : { probe_invalid:true, selected:probe??null, observation:null });
      }
      if (stage.phase === 'calculate' && stage.case_id === 'C3') writeDerived('measurement.json',cases.C3.replication);
      const current = store.read(), task = current.tasks[stage.task_id].spec;
      verifyPreparedCampaign(directory,manifest,current.benchmarks.requests[manifest.request_id],derived);
      benchmarkAdmission(current,task,{tokens:task.budget.reservation_tokens,cost_usd:0});
      const attempt = await runTask(store,stage.task_id,'benchmark-operator',1,manifest.request_id+'_'+stage.task_id);
      requireThat(attempt.observed_state === 'completed' && attempt.result?.validity === 'current','Benchmark stopped after transport/integration failure; inspect the retained trace and do not retry automatically');
      let answer=null, parseError=null;
      try { answer=JSON.parse(attempt.result.summary); } catch(error) { parseError=error.message; }
      const output={...stage,attempt_id:attempt.attempt_id,answer,planning_review:attempt.result.planning_review??null,parse_error:parseError,scientific_review:'pending_human_review'};
      prior.push(output); trialOutputs.set(stage.trial,prior); outputs.push(output);
      writeJSON(path.join(directory,'outputs',stage.task_id+'.json'),{...output,result:attempt.result});
      process.stdout.write(JSON.stringify({task_id:stage.task_id,status:attempt.observed_state,summary_parsed:!parseError})+'\n');
    }
    result={request_id:manifest.request_id,model_policy:manifest.model_policy,scientific_novelty_evaluated:false,qualitative_review:'pending_human_review',
      outputs,numeric_checks:[...trialOutputs.entries()].map(([trial,entries])=>({trial,checks:numericChecks(entries[0].case_id,entries.find((e)=>e.phase==='calculate')?.answer,selectedProbe(entries))})),
      usage:store.read().usage,limitations:['One repetition per case; no topology baseline.','Agent evaluator is not independent ground truth.','Subscription USD cost/quota may be unknown; reservation cost is not observed cost.','Logical workspace separation, not proven read isolation.']};
    writeJSON(path.join(directory,'benchmark-results.json'),result);
    return result;
  } finally { store.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(path.resolve(process.argv[2] || path.join(ROOT,'benchmark-runs/b01_20261025_02'))).catch(error=>{process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;});
}
