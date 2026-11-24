import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,task} from './helpers.mjs';
import {runTask} from '../src/runner.mjs';
import {failureEvidence} from '../src/failures.mjs';
import {usageEvidence} from '../adapters/index.mjs';
const envelope={adapter_failure:{version:1,code:'Unauthorized',message:'Native permission denied: write_file at D:/control/.harness-helper/request.json'},usage:{input_tokens:10,output_tokens:2,cached_input_tokens:null,cost_usd:null}};
test('structured command failure preserves authorization evidence without trusting arbitrary output',()=>{
 assert.equal(failureEvidence('result-json',JSON.stringify(envelope)).code,'Unauthorized');
 assert.equal(failureEvidence('result-json','{"error":"Unauthorized"}'),null);
 assert.equal(failureEvidence('result-json','{partial'),null);
 assert.equal(failureEvidence('result-json',JSON.stringify({...envelope,adapter_failure:{version:2,code:'Unauthorized',message:'x'}})),null);
});
test('failed command usage requires versioned diagnostic and valid subset accounting',()=>{
 assert.equal(usageEvidence('result-json',JSON.stringify(envelope)).input_tokens,10);
 assert.equal(usageEvidence('result-json',JSON.stringify({usage:envelope.usage})),null);
 for(const usage of [{input_tokens:-1},{input_tokens:10,cached_input_tokens:11},{input_tokens:10,output_tokens:-2}]) assert.equal(usageEvidence('result-json',JSON.stringify({...envelope,usage})),null);
});
test('real failing process records authorization error and usage instead of missing result',async t=>{
 const {store}=fixture(t,c=>{c.execution.allow_external=true;c.backends.local_denied={kind:'command',command:process.execPath,args:['-e','process.stdin.resume();process.stdout.write('+JSON.stringify(JSON.stringify(envelope))+');process.exitCode=1;'],protocol:'result-json',allow_execute:true};});
 task(store,{backend:'local_denied'});const a=await runTask(store,'review_scope','local',1,'denial-fixture');
 assert.equal(a.observed_state,'failed');assert.equal(a.error,envelope.adapter_failure.message);assert.equal(a.reported_usage.input_tokens,10);assert.equal(a.accounted_tokens,12);assert.equal(a.failure.reason,'authorization');
});
