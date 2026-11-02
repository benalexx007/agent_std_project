import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fixture, task, spec } from './helpers.mjs';
import { runTask } from '../src/runner.mjs';
import { control, beginAttempt, finishAttempt } from '../src/engine.mjs';
import { ROOT } from '../src/util.mjs';
import { parseOutput, invocation, usageEvidence } from '../adapters/index.mjs';
import { main } from '../scripts/harness.mjs';
import { usageReport } from '../src/report.mjs';
import { setTimeout as delay } from 'node:timers/promises';

async function until(fn, timeout = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for fixture state');
    await delay(20);
  }
}
test('real fixture process records result, logs, context and configuration snapshot', async (t) => {
  const { store } = fixture(t);
  task(store);
  const result = await runTask(store, 'review_scope', 'local', 1, 'one');
  assert.equal(result.observed_state, 'completed');
  assert.equal(store.read().tasks.review_scope.status, 'completed');
  const context = JSON.parse(fs.readFileSync(path.join(store.directory, 'attempts', result.attempt_id, 'context.json')));
  assert.equal(context.dispatch.attempt_id, result.attempt_id);
  const replay = await runTask(store, 'review_scope', 'local', 1, 'one');
  assert.equal(replay.duplicate, true);
  assert.equal(Object.keys(store.read().attempts).length, 1);
});
test('missing, malformed and failed-check outputs do not pass on exit code zero', async (t) => {
  const { store } = fixture(t);
  for (const [index, options] of [{ missing_output: true }, { malformed: true }, { failed_check: true }, { fail: true }].entries()) {
    const tid = 'task' + index;
    task(store, { task_id: tid, mock: { duration_ms: 5, ...options } });
    const result = await runTask(store, tid, 'local', 1, 'key' + index);
    assert.equal(result.observed_state, 'failed');
    assert.equal(store.read().tasks[tid].status, 'failed');
  }
});
test('cancel a running branch without stopping an independent branch', async (t) => {
  const { store } = fixture(t);
  task(store, { task_id: 'baseline', mock: { duration_ms: 700 } });
  task(store, { task_id: 'variant', mock: { duration_ms: 1500 } });
  const a = runTask(store, 'baseline', 'local', 1, 'baseline-key');
  const b = runTask(store, 'variant', 'local', 1, 'variant-key');
  control(store, { event_id: 'cancel-B', action: 'cancel', target: 'variant', payload: {} });
  const [baseline, variant] = await Promise.all([a, b]);
  assert.equal(baseline.observed_state, 'completed');
  assert.equal(variant.observed_state, 'cancelled');
  assert.equal(store.read().events['cancel-B'].status, 'verified');
});
test('pause reaches task checkpoint and resume uses saved result without rerun', async (t) => {
  const { store } = fixture(t);
  task(store, { mock: { duration_ms: 250 } });
  const running = runTask(store, 'review_scope', 'local', 1, 'one');
  const ack = control(store, { event_id: 'pause1', action: 'pause', target: 'review_scope', payload: {} });
  assert.equal(ack.status, 'applied');
  await running;
  assert.equal(store.read().tasks.review_scope.status, 'paused');
  control(store, { event_id: 'resume1', action: 'resume', target: 'review_scope', payload: {} });
  assert.equal(store.read().tasks.review_scope.status, 'completed');
  assert.equal(Object.keys(store.read().attempts).length, 1);
});
test('status and steer preserve original objective, steer acknowledgement is distinct', async (t) => {
  const { store } = fixture(t);
  const original = task(store, { mock: { duration_ms: 500 } });
  const running = runTask(store, 'review_scope', 'local', 1, 'one');
  control(store, { event_id: 'status1', action: 'status', target: 'project', payload: {} });
  const ack = control(store, { event_id: 'steer1', action: 'steer', target: 'review_scope', payload: { message: 'Inspect leakage first' } });
  assert.equal(ack.status, 'pending');
  await until(() => store.read().events.steer1.status === 'verified');
  await running;
  assert.equal(store.read().tasks.review_scope.spec.objective, original.objective);
});
test('timeout requests cancellation and does not report success', async (t) => {
  const { store } = fixture(t);
  const original = spec();
  task(store, { mock: { duration_ms: 5000 }, budget: { ...original.budget, timeout_ms: 100 } });
  const result = await runTask(store, 'review_scope', 'local', 1, 'one');
  assert.equal(result.observed_state, 'cancelled');
  assert.equal(result.error, 'timeout');
});
test('a second CLI process can cancel while the runner is occupied', async (t) => {
  const { store, configFile } = fixture(t);
  task(store, { mock: { duration_ms: 5000 } });
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/harness.mjs'), 'run-task', '--config', configFile,
    '--task', 'review_scope', '--owner', 'local', '--epoch', '1', '--key', 'cli-key', '--execute'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (c) => { output += c; }); child.stderr.resume();
  const exit = new Promise((resolve) => child.once('close', resolve));
  await until(() => Object.values(store.read().attempts).some((a) => a.observed_state === 'running'));
  const ack = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/harness.mjs'), 'control-task', '--config', configFile,
    '--action', 'cancel', '--target', 'review_scope', '--event', 'from-another-process'], { encoding: 'utf8', windowsHide: true }));
  assert.equal(ack.status, 'applied');
  await exit;
  assert.equal(JSON.parse(output).observed_state, 'cancelled');
  assert.equal(store.read().events['from-another-process'].status, 'verified');
});
test('prepare-task and default run-task do not dispatch', async (t) => {
  const { store, configFile } = fixture(t);
  task(store);
  const output = await main(['run-task', '--config', configFile, '--task', 'review_scope']);
  assert.equal(output.executed, false);
  assert.equal(Object.keys(store.read().attempts).length, 0);
});
test('one-shot adapters do not claim native steer/resume; commands bypass the shell', (t) => {
  const { loaded } = fixture(t);
  const input = spec({ model: 'explicit-model' });
  const cmd = invocation(loaded.config.backends.codex, input, { text: 'prompt', packet: {} }, {});
  assert.equal(cmd.command, 'codex');
  assert.ok(cmd.args.includes('--sandbox'));
  assert.ok(cmd.args.includes('read-only'));
  assert.equal(cmd.stdin, 'prompt');
  const agy = invocation(loaded.config.backends.antigravity, input, { text: 'prompt', packet: {} }, {});
  assert.deepEqual(agy.args.slice(0, 4), ['--input-format', 'stream-json', '--output-format', 'stream-json']);
  assert.ok(agy.args.includes('--sandbox'));
  assert.equal(JSON.parse(agy.stdin).message.content, 'prompt');
});
test('Antigravity accepts one terminal result, rejects failed or ambiguous streams and uses terminal usage only', () => {
  const payload={task_id:'automation',usage:{input_tokens:999999,output_tokens:999999}};
  const envelope={conversation_id:'agy-session',status:'SUCCESS',num_turns:1,response:JSON.stringify(payload),
    usage:{input_tokens:100,output_tokens:20,thinking_tokens:15,cache_read_tokens:60,total_tokens:120}};
  const terminal=(result)=>JSON.stringify({event:'result',result});
  const stdout=[JSON.stringify({event:'init',conversation_id:'agy-session'}),
    JSON.stringify({event:'step_update',step_update:{usage:{input_tokens:90,output_tokens:18}}}),terminal(envelope)].join('\n');
  const parsed=parseOutput('agy-jsonl',stdout);
  assert.equal(parsed.session_id,'agy-session');
  assert.deepEqual(parsed.result.usage,{input_tokens:100,output_tokens:20,cached_input_tokens:60,cost_usd:null});
  assert.throws(()=>parseOutput('agy-jsonl',terminal({...envelope,status:'ERROR',error:'unavailable'})),/failed turn/);
  assert.throws(()=>parseOutput('agy-jsonl',stdout+'\n'+terminal(envelope)),/one terminal/);
  assert.throws(()=>parseOutput('agy-jsonl',JSON.stringify({event:'step_update'})),/one terminal/);
  assert.throws(()=>parseOutput('agy-jsonl',terminal({...envelope,num_turns:2})),/multiple/);
  assert.throws(()=>parseOutput('agy-jsonl',terminal({...envelope,response:'not-json'})),/JSON|Unexpected/);
  assert.equal(usageEvidence('agy-jsonl',terminal({...envelope,usage:{input_tokens:-1}})),null);
  assert.equal(parseOutput('agy-jsonl',terminal({...envelope,usage:undefined})).result.usage.input_tokens,null);
});

test('Codex and Claude parsers use reported usage and reject transport errors', () => {
  const raw = { task_id: 'x' };
  const parsed = parseOutput('codex-jsonl', [
    JSON.stringify({ type: 'thread.started', thread_id: 'session' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(raw) } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 30, cached_input_tokens: 20, output_tokens: 5 } })
  ].join('\n'));
  assert.equal(parsed.result.usage.input_tokens, 30);
  assert.equal(parsed.result.usage.cached_input_tokens, 20);
  assert.throws(() => parseOutput('codex-jsonl', '{"type":"turn.failed"}'), /failed/);
  const claude = parseOutput('claude-json', JSON.stringify({ subtype: 'success', result: JSON.stringify(raw),
    usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 3 }, total_cost_usd: 0.01 }));
  assert.equal(claude.result.usage.input_tokens, 35);
  assert.throws(() => parseOutput('claude-json', '{"is_error":true}'), /error/);
  assert.equal(parseOutput('text', '{"usage":{"input_tokens":1000}}').result.usage.input_tokens, null);
});
test('emergency control still works when the configuration file is broken', async (t) => {
  const { store, directory, configFile } = fixture(t);
  task(store);
  fs.writeFileSync(configFile, '{broken');
  const result = await main(['control-task', '--workspace', directory, '--action', 'pause', '--target', 'project', '--event', 'emergency-pause']);
  assert.equal(result.status, 'verified');
  assert.equal(store.read().desired_state, 'paused');
});
test('cancelled external command reports unknown descendants instead of false stopped', async (t) => {
  const { store } = fixture(t, (c) => {
    c.execution.allow_external = true;
    c.backends.local_fixture = { kind: 'command', command: process.execPath,
      args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'], protocol: 'result-json', allow_execute: true };
  });
  task(store, { backend: 'local_fixture', mock: { duration_ms: 5000 } });
  const running = runTask(store, 'review_scope', 'local', 1, 'one');
  control(store, { event_id: 'stop-command', action: 'cancel', target: 'review_scope', payload: {} });
  const result = await running;
  assert.equal(result.observed_state, 'unknown');
  assert.equal(store.read().events['stop-command'].status, 'unverified');
  assert.equal(result.settled, false);
});
test('usage report labels fixture tokens and does not invent human active time', async (t) => {
  const { store } = fixture(t);
  task(store);
  await runTask(store, 'review_scope', 'local', 1, 'one');
  const report = usageReport(store.read());
  assert.equal(report.by_backend.mock.fixture, true);
  assert.equal(report.structurally_accepted_tasks, 1);
  assert.equal(report.tokens_per_structurally_accepted_task, 30);
  assert.match(report.limitations.join(' '), /not a scientifically accepted/);
});
