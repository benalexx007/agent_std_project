// Preparation and grader software tests only; never starts an external model.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fixture } from './helpers.mjs';
import { prepare } from '../benchmarks/b01/prepare.mjs';
import { run, numericChecks, verifyPreparedCampaign, selectedProbe, handoffForStage } from '../benchmarks/b01/run.mjs';
import { Store } from '../src/store.mjs';
import { readJSON } from '../src/util.mjs';
import { rawArtifact } from './research-fixtures.mjs';

test('B01 preparation pins seventeen tiered tasks and creates only a pending permission request', (t) => {
  const { directory } = fixture(t);
  const campaign = path.join(directory,'prepared');
  const result = prepare(campaign,process.execPath);
  assert.equal(result.stages,17);
  assert.equal(result.model_calls_made,0);
  const manifest=readJSON(path.join(campaign,'manifest.json'));
  assert.equal(manifest.stages.filter((s)=>s.case_id==='C3').length,5);
  assert.equal(manifest.stages.filter((s)=>s.model==='gpt-6-astra' && s.reasoning_effort==='high').length,4);
  assert.equal(manifest.stages.filter((s)=>s.model==='gpt-6.1-sol' && s.reasoning_effort==='high').length,13);
  const store=new Store(campaign);
  try {
    assert.equal(store.read().benchmarks.requests[result.request_id].status,'pending');
    assert.equal(Object.keys(store.read().attempts).length,0);
    const state=store.read();
    assert.deepEqual(state.config.model_policy.task_class_backends,{});
    assert.equal(Object.keys(state.tasks).length,17);
    const specs=Object.values(state.tasks).map((t)=>t.spec);
    assert.equal(specs.reduce((n,s)=>n+s.budget.reservation_tokens,0),380000);
    for (const spec of specs.filter((s)=>s.task_class==='synthesis_planning')) {
      assert.equal(spec.model_tier,'highest');
      assert.equal(spec.analysis_input_paths.length,1);
      assert.ok(spec.inputs.some((i)=>i.path===spec.analysis_input_paths[0]));
      assert.ok(!spec.inputs.some((i)=>i.path.endsWith('measurement.json')));
    }
    verifyPreparedCampaign(campaign,manifest,state.benchmarks.requests[result.request_id]);
    assert.equal(state.benchmarks.requests[result.request_id].execution_manifest.path,'manifest.json');
  } finally {store.close();}
});

test('B01 integrity checks detect changed manifest, raw inputs and derived evidence', (t) => {
  const {directory}=fixture(t),campaign=path.join(directory,'integrity');
  const prepared=prepare(campaign,process.execPath), manifest=readJSON(path.join(campaign,'manifest.json'));
  const store=new Store(campaign);
  try {
    const request=store.read().benchmarks.requests[prepared.request_id];
    const original=fs.readFileSync(path.join(campaign,'manifest.json'));
    fs.appendFileSync(path.join(campaign,'manifest.json'),' ');
    assert.throws(()=>verifyPreparedCampaign(campaign,manifest,request),/hash mismatch/);
    fs.writeFileSync(path.join(campaign,'manifest.json'),original);
    const derived=rawArtifact(campaign,'derived.json','A model output fixture, not a real model call');
    verifyPreparedCampaign(campaign,manifest,request,[derived]);
    fs.writeFileSync(path.join(campaign,derived.path),'Changed derived evidence');
    assert.throws(()=>verifyPreparedCampaign(campaign,manifest,request,[derived]),/hash mismatch/);
    fs.writeFileSync(path.join(campaign,'trials/c1_r1/initial.json'),'{}');
    assert.throws(()=>verifyPreparedCampaign(campaign,manifest,request),/hash mismatch/);
  } finally {store.close();}
});

test('C2 release uses only the final planner probe, not preliminary analysis', () => {
  assert.equal(selectedProbe([{phase:'analysis',answer:{next_probe:1}},{phase:'plan',answer:{next_probe:5}}]),5);
  assert.equal(selectedProbe([{phase:'analysis',answer:{next_probe:1}}]),undefined);
});

test('B01 execution refuses a prepared but unapproved campaign before any worker launch', async (t) => {
  const { directory }=fixture(t), campaign=path.join(directory,'pending');
  prepare(campaign,process.execPath);
  await assert.rejects(()=>run(campaign),/Ask the human/);
  const store=new Store(campaign);
  try {assert.equal(Object.keys(store.read().attempts).length,0);} finally {store.close();}
});

test('B01 numeric grader detects wrong rates and an invalid selected probe without judging prose', () => {
  const correct=numericChecks('C1',{calculations:{A_pooled:29/110,B_pooled:81/110,A_mild:.9,B_mild:.8,A_severe:.2,B_severe:.1}});
  assert.ok(correct.every((c)=>c.passed));
  assert.ok(numericChecks('C1',{calculations:{A_pooled:.9}}).some((c)=>!c.passed));
  assert.equal(numericChecks('C2',{},null)[0].passed,false);
  assert.ok(numericChecks('C2',{calculations:{probe_x:4,probe_y:10}},4).every((c)=>c.passed));
  assert.ok(numericChecks('C3',{calculations:{initial_difference:.25,replication_difference:-.05,pooled_difference:0}}).every((c)=>c.passed));
  assert.ok(numericChecks('C4',{calculations:{f_at_2:2,g_at_2:4}}).every((c)=>c.passed));
});

test('B01 handoff selects stage dependencies while evaluator retains all case evidence and audit', () => {
  const prior = ['analysis', 'plan', 'calculate', 'update'].map((phase) => ({ phase, answer: { full: phase }, planning_review: phase === 'plan' ? { limitations: ['Keep audit'] } : null }));
  assert.deepEqual(handoffForStage(prior, 'calculate').map((e) => e.phase), ['plan']);
  assert.deepEqual(handoffForStage(prior, 'update').map((e) => e.phase), ['plan', 'calculate']);
  assert.deepEqual(handoffForStage(prior, 'review'), prior);
  assert.equal(handoffForStage(prior, 'calculate')[0], prior[1]);
  assert.throws(() => handoffForStage(prior, 'unknown'), /Unknown/);
});

test('B01 archived campaign manifests remain immutable when source has changed', (t) => {
  const { directory } = fixture(t), campaign = path.join(directory, 'source-drift');
  const prepared = prepare(campaign, process.execPath), manifest = readJSON(path.join(campaign, 'manifest.json'));
  const store = new Store(campaign);
  try {
    const changed = structuredClone(manifest);
    changed.source_hashes['src/engine.mjs'] = '0'.repeat(64);
    assert.throws(() => verifyPreparedCampaign(campaign, changed, store.read().benchmarks.requests[prepared.request_id]), /source changed/);
    assert.equal(Object.keys(store.read().attempts).length, 0);
  } finally { store.close(); }
});
