import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, task } from './helpers.mjs';
import { runAttempt } from '../src/runner.mjs';
import { previewAttempt, beginAttempt, finishAttempt, reconcile, observeJob } from '../src/engine.mjs';
import { buildContext } from '../src/context.mjs';
import { sqliteContention, monitorRetryWindow } from '../src/control-monitor.mjs';
import { hash } from '../src/util.mjs';

test('SQLite retry classification excludes unrelated errors and bounds by lease', () => {
  for (const error of [{code:'SQLITE_BUSY'}, {code:'SQLITE_LOCKED_SHAREDCACHE'}, {code:'ERR_SQLITE_ERROR',errcode:5}, {errcode:262}]) assert.equal(sqliteContention(error), true);
  for (const error of [{message:'database is locked'}, {errcode:14}, {code:'EACCES'}, new Error('broken')]) assert.equal(sqliteContention(error), false);
  assert.equal(monitorRetryWindow(120),60); assert.equal(monitorRetryWindow(120000),30000);
});

function monitorFixture(t) {
  return fixture(t, (c) => { c.checkpoint_policy = {lease_ms: 400}; c.execution.poll_ms = 20; });
}
function injectHeartbeatError(store, makeError) {
  const original = store.transaction.bind(store);
  let failures = 0;
  store.transaction = (fn) => {
    if (fn.toString().includes('assignment.heartbeat_at')) {
      const error = makeError(++failures);
      if (error) throw error;
    }
    return original(fn);
  };
  return () => failures;
}
test('transient heartbeat contention recovers without cancelling the real fixture worker', async (t) => {
  const {store} = monitorFixture(t);
  task(store, {mock:{duration_ms: 900}});
  const count = injectHeartbeatError(store, (n) => n <= 2 ? Object.assign(new Error('database is locked'),{code:'ERR_SQLITE_ERROR',errcode:5}) : null);
  const result = await runAttempt(store,'review_scope','local',1,'transient');
  assert.equal(result.observed_state,'completed'); assert.ok(count() >= 3);
  const logs = fs.readFileSync(path.join(store.directory,'attempts',result.attempt_id,'control-monitor.jsonl'),'utf8');
  assert.match(logs,/sqlite_contention_retry/); assert.match(logs,/sqlite_contention_recovered/);
});
test('persistent contention stops within the bounded retry window', async (t) => {
  const {store} = monitorFixture(t);
  task(store, {mock:{duration_ms: 5000}});
  injectHeartbeatError(store, () => Object.assign(new Error('database is locked'),{errcode:5}));
  const started = Date.now(), result = await runAttempt(store,'review_scope','local',1,'persistent');
  assert.notEqual(result.observed_state,'completed');
  assert.match(result.error,/Control monitor contention limit/);
  assert.ok(Date.now()-started < 4000);
});
test('real SQLite writer lock is retried and recovered without losing worker output', async (t) => {
  const {store}=monitorFixture(t); task(store,{mock:{duration_ms:900}});
  const blocker=new DatabaseSync(store.file), original=store.transaction.bind(store);
  store.db.exec('PRAGMA busy_timeout=0');
  let locked=false, injected=false, release;
  store.transaction=(fn)=>{
    if(!injected && fn.toString().includes('assignment.heartbeat_at')) {
      injected=true; blocker.exec('BEGIN IMMEDIATE'); locked=true;
      release=setTimeout(()=>{blocker.exec('ROLLBACK');locked=false;},80);
    }
    return original(fn);
  };
  try {
    const result=await runAttempt(store,'review_scope','local',1,'real-lock');
    assert.equal(result.observed_state,'completed'); assert.equal(injected,true);
    const log=fs.readFileSync(path.join(store.directory,'attempts',result.attempt_id,'control-monitor.jsonl'),'utf8');
    assert.match(log,/sqlite_contention_retry/); assert.match(log,/sqlite_contention_recovered/);
  } finally { clearTimeout(release); if(locked)blocker.exec('ROLLBACK');blocker.close(); }
});
test('permanent monitor error fails closed without contention retry', async (t) => {
  const {store} = monitorFixture(t);
  task(store, {mock:{duration_ms: 5000}});
  injectHeartbeatError(store, () => Object.assign(new Error('I/O failure'),{errcode:10}));
  const result = await runAttempt(store,'review_scope','local',1,'permanent');
  assert.match(result.error,/Control monitor error: I\/O failure/);
  assert.equal(fs.existsSync(path.join(store.directory,'attempts',result.attempt_id,'control-monitor.jsonl')),false);
});
test('full preview includes dispatch and isolated workspace, creates no state or directory', (t) => {
  const {store,directory} = fixture(t,c => {
    c.context.max_chars = 96000;
    c.workspace_policy = {mode:'snapshot_directory',include:[],max_files:100,max_bytes:1000000,max_writers:2};
  });
  task(store,{writes_workspace:true});
  const before=store.read(), prepared=previewAttempt(before,'review_scope');
  assert.deepEqual(store.read(),before);
  assert.ok(prepared.context.packet.dispatch.attempt_id);
  assert.equal(prepared.context.packet.control_root,directory);
  assert.equal(prepared.context.packet.workspace,prepared.attempt.workspace.root);
  assert.equal(fs.existsSync(prepared.attempt.workspace.root),false);
  const dispatched=beginAttempt(store,'review_scope','local',1,'actual');
  assert.equal(prepared.context.characters,dispatched.context.characters);
});
test('prepare and dispatch both reject metadata overflow before reserving an attempt', (t) => {
  const {store} = fixture(t,c=>{c.context.max_chars=96000;}); task(store);
  const s=store.read(), base=buildContext(s.config,s.tasks.review_scope.spec,[],[],s);
  store.transaction(next=>{next.config.context.max_chars=base.characters;});
  const before=store.read();
  assert.throws(()=>previewAttempt(before,'review_scope'),/Execution context exceeds max_chars/);
  assert.throws(()=>beginAttempt(store,'review_scope','local',1,'overflow'),/Execution context exceeds max_chars/);
  assert.deepEqual(store.read(),before);
});
test('reconciliation preserves terminal extension receipts and refuses unresolved helpers', (t) => {
  const {store,directory}=fixture(t); task(store);
  const a=beginAttempt(store,'review_scope','local',1,'reconcile').attempt;
  store.transaction(s=>{s.attempts[a.attempt_id].job_refs=[{job_id:'helper',kind:'extension',owner_attempt:a.attempt_id,observed_state:'running'}];});
  finishAttempt(store,a.attempt_id,{status:'unknown'});
  fs.writeFileSync(path.join(directory,'evidence.txt'),'fixture evidence');
  const evidence=[{path:'evidence.txt',sha256:hash('fixture evidence')}];
  const observation={attempt_id:a.attempt_id,status:'failed',evidence};
  assert.throws(()=>reconcile(store,[observation]),/terminal external\/extension/);
  assert.equal(store.read().attempts[a.attempt_id].settled,false);
  observeJob(store,a.attempt_id,'helper',{status:'completed',evidence});
  reconcile(store,[observation]);
  const result=store.read().attempts[a.attempt_id];
  assert.equal(result.job_refs[0].observed_state,'completed');
  assert.deepEqual(result.job_refs[0].evidence,evidence); assert.equal(result.settled,true);
});
