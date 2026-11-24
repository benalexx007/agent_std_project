// Kiem tra adapter that dung lenh dung va parse su kien mau theo tai lieu (KHONG goi backend that).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaudeAdapter } from '../lib/adapters/claude-code.mjs';
import { createCodexAdapter } from '../lib/adapters/codex.mjs';
import { createAntigravityAdapter, parseAgyError } from '../lib/adapters/antigravity.mjs';
import { normalizeSpec } from '../lib/schema.mjs';

const spec = normalizeSpec({ prompt: 'p', cwd: 'C:/Users/Firstname Lastname/proj' });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ad-'));
const feed = (a, lines) => { const acc = {}; const evs = lines.flatMap((l) => a.parseLine(JSON.stringify(l), acc)); return { acc, evs }; };

test('claude: lenh, resume, tool_start/tool_end, permission_denials, api_retry chi khi la tin hieu cuoi', () => {
  const a = createClaudeAdapter();
  const inv = a.buildInvocation({ spec, prompt: 'xin chao', sessionId: 's1', attemptDir: dir });
  assert.deepEqual(inv.args.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose']);
  assert.ok(inv.args.includes('--strict-mcp-config'));
  assert.ok(!inv.args.includes('--json-schema'), 'schema native cua Claude mac dinh tat (B20.1)');
  assert.equal(inv.args[inv.args.indexOf('--resume') + 1], 's1');
  assert.equal(inv.stdin, 'xin chao');
  const failed = feed(a, [
    { type: 'system', subtype: 'init', session_id: 'S' },
    { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 5, retry_delay_ms: 2000, error_status: 429, error: 'rate_limit', session_id: 'S' },
    { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'fail', session_id: 'S' },
  ]);
  assert.equal(failed.evs.find((e) => e.kind === 'session').session_id, 'S');
  failed.acc.final = failed.evs.find((e) => e.kind === 'final');
  const f = a.classifyExit({ code: 1, stderrTail: '', acc: failed.acc });
  assert.equal(f.class, 'rate_limited');
  assert.equal(f.retryAfterMs, null, 'retry_delay_ms la backoff noi bo, khong phai thoi diem reset');
  // api_retry cu (da thanh cong sau do) khong duoc dung de phan loai loi sau
  const later = feed(a, [
    { type: 'system', subtype: 'api_retry', attempt: 1, error: 'overloaded', session_id: 'S' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash' }] }, session_id: 'S' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] }, session_id: 'S' },
    { type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 'S', permission_denials: [{ tool_name: 'Write', tool_input: { file_path: 'a.txt' } }] },
  ]);
  assert.deepEqual(later.evs.filter((e) => e.kind.startsWith('tool_')).map((e) => `${e.kind}:${e.id}`), ['tool_start:tu1', 'tool_end:tu1']);
  assert.equal(later.acc.lastApiRetry, null);
  assert.equal(later.acc.denials[0].tool, 'Write');
  assert.equal(a.classifyExit({ code: 2, stderrTail: 'boom', acc: later.acc }).class, 'crash');
  // thieu API key (R-bare) -> auth, thong bao neu dung nguyen nhan
  const bare = a.classifyExit({ code: 1, stderrTail: 'Invalid API key - please set ANTHROPIC_API_KEY', acc: {} });
  assert.equal(bare.class, 'auth');
  assert.match(bare.message, /--bare/);
});

test('codex: exec --json, resume, schema strict ghi ra file (P1), tool item, tat schema khi bi tu choi', () => {
  const a = createCodexAdapter();
  const inv = a.buildInvocation({ spec, prompt: 'p', sessionId: null, attemptDir: dir });
  assert.equal(inv.args[0], 'exec');
  assert.ok(inv.args.includes('--json') && inv.args.includes('--output-schema'));
  assert.equal(inv.args.at(-1), '-');
  const schema = JSON.parse(fs.readFileSync(inv.args[inv.args.indexOf('--output-schema') + 1], 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.outputs, { type: ['object', 'null'], properties: {}, additionalProperties: false, required: [] });
  assert.ok(schema.properties.artifacts.items.properties.description);
  const off = a.buildInvocation({ spec, prompt: 'p', sessionId: null, attemptDir: dir, nativeSchemaOff: true });
  assert.ok(!off.args.includes('--output-schema'));
  const anyObj = a.buildInvocation({ spec: normalizeSpec({ prompt: 'p', output_schema: { type: 'object' } }), prompt: 'p', sessionId: null, attemptDir: dir });
  assert.ok(!anyObj.args.includes('--output-schema'), 'output_schema khong strict duoc -> khong dung schema native');
  const r = a.buildInvocation({ spec, prompt: 'p', sessionId: 'th1', attemptDir: dir });
  assert.deepEqual(r.args.slice(0, 3), ['exec', 'resume', 'th1']);
  const { evs } = feed(a, [
    { type: 'thread.started', thread_id: 'th1' },
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'npm test' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'npm test' } },
    { type: 'item.completed', item: { type: 'agent_message', text: '```json\n{"status":"succeeded","summary":"x"}\n```' } },
    { type: 'turn.completed', usage: { input_tokens: 10 } },
  ]);
  assert.equal(evs[0].session_id, 'th1');
  assert.deepEqual(evs.filter((e) => e.kind.startsWith('tool_')).map((e) => e.kind), ['tool_start', 'tool_end']);
  assert.match(evs.find((e) => e.kind === 'final').text, /succeeded/);
  const rej = a.classifyExit({ code: 1, stderrTail: 'Invalid schema for response_format: additionalProperties must be false', acc: {}, inv });
  assert.equal(rej.class, 'config');
  assert.equal(rej.schemaRejected, true);
});

test('antigravity: agy -p stream-json, --conversation, AGY_ERROR exit 3, WAITING/INVALID/CANCELED, exit 1', () => {
  const a = createAntigravityAdapter();
  const inv = a.buildInvocation({ spec, prompt: 'p', sessionId: 'c1', attemptDir: dir });
  assert.equal(inv.args[inv.args.indexOf('--conversation') + 1], 'c1');
  assert.deepEqual(JSON.parse(inv.stdin), { event: 'user', message: { content: 'p' } });
  const { acc, evs } = feed(a, [
    { event: 'init', cwd: '.' },
    { event: 'step_update', conversation_id: 'c1', step_type: 'tool', step_id: 's1', state: 'RUNNING', tool_name: 'run_command' },
    { event: 'step_update', conversation_id: 'c1', step_type: 'tool', step_id: 's1', state: 'DONE', tool_name: 'run_command' },
    { event: 'result', conversation_id: 'c1', status: 'ERROR', error: 'authentication required' },
  ]);
  assert.deepEqual(evs.filter((e) => e.kind.startsWith('tool_')).map((e) => e.kind), ['tool_start', 'tool_end']);
  acc.final = evs.find((e) => e.kind === 'final');
  assert.equal(a.classifyExit({ code: 1, stderrTail: '', acc }).class, 'auth');
  const stderr = 'AGY_ERROR: {"canonical_status": "RESOURCE_EXHAUSTED", "error_code": 429, "retryable": false, "error_id": "err_quota_exceeded"}';
  assert.equal(parseAgyError(stderr).error_code, 429);
  assert.equal(a.classifyExit({ code: 3, stderrTail: stderr, acc: {} }).class, 'rate_limited');
  const st = (status) => a.classifyExit({ code: 0, stderrTail: '', acc: { final: { status, is_error: status !== 'SUCCESS' } } }).class;
  assert.equal(st('WAITING'), 'permission');
  assert.equal(st('INVALID'), 'config');
  assert.equal(st('CANCELED'), 'cancelled');
  assert.equal(a.classifyExit({ code: 1, stderrTail: 'unknown agent foo', acc: {} }).class, 'config');
});
