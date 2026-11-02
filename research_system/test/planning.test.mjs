import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, task, resultFor } from './helpers.mjs';
import { rawArtifact } from './research-fixtures.mjs';
import { beginAttempt, validateResult, finishAttempt, currentTaskResult } from '../src/engine.mjs';
import { nativeToolHandler } from '../src/native-tools.mjs';

function setup(t) {
  const f=fixture(t,(c)=>{
    c.backends.mock.model_family='codex';
    c.context.max_chars=96000; // The headless coordinator also carries the bounded task contract/frontier.
    c.roles.orchestrator={profile:'domains/research/roles/orchestrator.md',skills:['research-design'],backend:'mock'};
  });
  const analysis=rawArtifact(f.directory,'analysis.md','Previous analyst conclusion: assume this is correct.');
  const source=rawArtifact(f.directory,'source.md','Primary source/code/data captured by the verifier.');
  task(f.store,{task_class:'synthesis_planning',inputs:[{...analysis,include:true},{...source,include:true}],analysis_input_paths:['analysis.md']});
  const started=beginAttempt(f.store,'review_scope','local',1,'planning-check');
  const review={verified_for_attempt_id:started.attempt.attempt_id,status:'ready',analysis_refs:[analysis],
    primary_checks:[{claim:'Analyst assumption',method:'primary_source_read',source,checked_at:started.attempt.timestamps.created_at,
      finding:'Source inspected independently',comparison_with_analysis:'Scope requires a correction'}],
    research_checks:[{question:'Is the assumption supported?',query_or_inspection:'Fresh inspection of authoritative source/code/data',
      checked_at:started.attempt.timestamps.created_at,sources:[source],finding:'A narrower conclusion is justified'}],
    disagreements:['Analyst generalized too broadly'],assumptions:['Primary source applies only to the stated setting'],blocking_questions:[],limitations:['Fixture attestation only']};
  return {...f,...started,analysis,source,review};
}

test('planning context requires independent research and completed plans need a review record', (t)=>{
  const f=setup(t);
  assert.equal(f.context.packet.planning_requirements.independent_research,true);
  assert.ok(f.context.packet.research_guidance.some((r)=>r.mode==='planning_verification'));
  assert.ok(f.context.packet.bundle_refs.some((r)=>r.path==='skills/research-design/references/planning-verification.md'));
  assert.throws(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt)),/invalid type|required/);
  assert.doesNotThrow(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt,{planning_review:f.review})));
});

test('a researcher advisor returns an audited plan before an analysis coordinator can execute it', async (t)=>{
  const f=setup(t);
  assert.equal(f.context.packet.position,'worker');
  assert.equal(f.context.packet.role,'researcher');
  assert.equal(f.context.packet.orchestration,undefined);
  assert.equal(f.attempt.effective_config.model,'gpt-6-astra');
  await assert.rejects(nativeToolHandler(f.store,f.attempt.attempt_id)('harness_register_task',{},'advisor-cannot-dispatch'),/Worker cannot use orchestration/);
  task(f.store,{task_id:'execute_plan',role:'orchestrator',skills:['research-design'],dependencies:['review_scope']});
  assert.throws(()=>beginAttempt(f.store,'execute_plan','local',1,'before-advice'),/Dependency/);
  assert.throws(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt)),/invalid type|required/);
  finishAttempt(f.store,f.attempt.attempt_id,{status:'completed',result:resultFor(f.attempt,{
    summary:'Advisor plan: test the narrower claim using the primary source; retain the unresolved proof obligation.',
    planning_review:f.review
  })});
  const coordinator=beginAttempt(f.store,'execute_plan','local',1,'after-advice');
  assert.equal(coordinator.attempt.effective_config.model,'gpt-6.1-sol');
  assert.equal(coordinator.attempt.effective_config.model_tier,'medium');
  assert.equal(coordinator.context.packet.planning_requirements,undefined);
  assert.equal(coordinator.context.packet.result_schema.properties.planning_review,undefined);
  assert.equal(coordinator.context.packet.orchestration.tasks.review_scope.result.summary,
    f.store.read().tasks.review_scope.result.summary);
  assert.doesNotThrow(()=>validateResult(f.store.read(),coordinator.attempt,resultFor(coordinator.attempt)));
  finishAttempt(f.store,coordinator.attempt.attempt_id,{status:'completed',result:resultFor(coordinator.attempt)});
  assert.equal(currentTaskResult(f.store.read(),'execute_plan'),true);
  fs.writeFileSync(path.join(f.directory,f.source.path),'Primary evidence changed after planning');
  assert.equal(currentTaskResult(f.store.read(),'execute_plan'),false);
});

test('planning cannot relabel an analysis summary as independently verified primary evidence', (t)=>{
  const f=setup(t),review=structuredClone(f.review);
  review.primary_checks[0].source=f.analysis;
  assert.throws(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt,{planning_review:review})),/Analysis summary/);
  const omitted=structuredClone(f.review);omitted.analysis_refs=[];
  assert.throws(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt,{planning_review:omitted})),/omitted/);
});

test('planning research must be recorded afresh for this attempt and blocking questions remain open', (t)=>{
  const f=setup(t),old=structuredClone(f.review);
  old.research_checks[0].checked_at='2000-01-01T00:00:00Z';
  assert.throws(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt,{planning_review:old})),/newly recorded/);
  const copied=structuredClone(f.review);copied.verified_for_attempt_id='previous_attempt';
  assert.throws(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt,{planning_review:copied})),/different attempt/);
  const blocked=structuredClone(f.review);blocked.blocking_questions=['A key claim has no usable source'];
  assert.throws(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt,{planning_review:blocked})),/needs independent/);
  assert.doesNotThrow(()=>validateResult(f.store.read(),f.attempt,resultFor(f.attempt,{status:'inconclusive',checks:[],unresolved:['Need evidence']})));
});

test('planning sources outside declared inputs remain tracked after result publication', (t)=>{
  const f=setup(t),external=rawArtifact(f.directory,'additional-source.md','Freshly inspected additional primary evidence');
  f.review.research_checks[0].sources.push(external);
  finishAttempt(f.store,f.attempt.attempt_id,{status:'completed',result:resultFor(f.attempt,{planning_review:f.review})});
  assert.equal(currentTaskResult(f.store.read(),'review_scope'),true);
  const result=f.store.read().attempts[f.attempt.attempt_id].result;
  assert.ok(result.evidence_refs.some((r)=>r.path===external.path));
  fs.writeFileSync(path.join(f.directory,external.path),'Changed evidence');
  assert.equal(currentTaskResult(f.store.read(),'review_scope'),false);
});
