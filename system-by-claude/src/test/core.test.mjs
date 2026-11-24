// Test don vi: store/journal, phan loai loi, schema/hop dong ket qua, schema strict (B2), envelope (B5), mat tien (B19).
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskStore, foldEvents } from '../lib/store.mjs';
import { classifyText, parseRetryAfterMs, decide, backoffMs } from '../lib/failures.mjs';
import {
  extractJsonBlock, parseFinalMessage, normalizeSpec, validate, clampSummary, strictify, strictFinalSchema,
  isStrictable, makeEnvelope, pickPublicSpec,
} from '../lib/schema.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orch-core-'));

test('store: createTask KHONG ghi journal; Journal ghi seq tang dan; snapshot = fold(journal)', () => {
  const s = new TaskStore(tmp());
  const { task } = s.createTask(normalizeSpec({ prompt: 'x', backend: 'codex' }));
  assert.equal(fs.existsSync(s.file(task.task_id, 'events.jsonl')), false);
  const j = s.openJournal(task.task_id);
  j.append('task.created', {});
  j.append('attempt.started', { backend: 'codex', pid: 123 }, 1);
  j.append('backend.session', { session_id: 'abc' }, 1);
  j.append('progress', { text: 'p' }, 1);
  const st = s.state(task.task_id);
  assert.equal(st.status, 'running');
  assert.equal(st.session_id, 'abc');
  assert.equal(st.backend_pid, 123);
  assert.equal(st.last_seq, 4);
  assert.deepEqual(s.events(task.task_id).map((e) => e.seq), [1, 2, 3, 4]);
  fs.unlinkSync(s.file(task.task_id, 'state.json'));
  assert.equal(s.state(task.task_id).session_id, 'abc');
  // writer moi (runner tiep quan) tiep tuc seq tu journal
  s.openJournal(task.task_id).append('task.interrupted', {});
  assert.equal(s.events(task.task_id).at(-1).seq, 5);
});

test('store: idempotency_key tra ve task cu', () => {
  const s = new TaskStore(tmp());
  const a = s.createTask(normalizeSpec({ prompt: 'x', idempotency_key: 'k1' }));
  const b = s.createTask(normalizeSpec({ prompt: 'y', idempotency_key: 'k1' }));
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.task.task_id, b.task.task_id);
  assert.equal(s.listTaskIds().length, 1);
});

test('store: dong journal cuoi bi cat khong lam hong doc/ghi', () => {
  const s = new TaskStore(tmp());
  const { task } = s.createTask(normalizeSpec({ prompt: 'x' }));
  s.openJournal(task.task_id).append('task.created', {});
  fs.appendFileSync(s.file(task.task_id, 'events.jsonl'), '{"seq":2,"type":"attempt.sta');
  assert.equal(s.events(task.task_id).length, 1);
  s.openJournal(task.task_id).append('progress', { text: 'ok' });
  assert.equal(s.rebuildState(task.task_id).progress, 'ok');
  assert.deepEqual(s.events(task.task_id).map((e) => e.seq), [1, 2]);
});

test('store: thong bao bat bien + cursor theo nguoi tieu thu (B6)', async () => {
  const s = new TaskStore(tmp());
  s.notify('t1', { status: 'succeeded', run_id: 'r1' });
  s.notify('t2', { status: 'failed', run_id: 'r2' });
  assert.equal((await s.readNotifications('sessA')).length, 2);
  assert.equal((await s.readNotifications('sessA')).length, 0, 'da doc thi khong thay lai');
  assert.equal((await s.readNotifications('sessB')).length, 2, 'nguoi tieu thu khac van thay du');
  assert.deepEqual((await s.readNotifications('sessC', { filter: (n) => n.run_id === 'r2' })).map((n) => n.task_id), ['t2']);
  assert.equal((await s.readNotifications('sessD', { advance: false })).length, 2);
  assert.equal((await s.readNotifications('sessD')).length, 2, 'advance:false khong doi cursor');
  assert.equal(fs.readdirSync(path.join(s.root, 'notifications')).length, 2, 'khong ai xoa thong bao');
});

test('fold: failover doi backend va xoa session; followup tang turn; interrupted dem', () => {
  const st = foldEvents({ task_id: 't', backend: 'claude' }, [
    { seq: 1, type: 'backend.session', data: { session_id: 's1' } },
    { seq: 2, type: 'task.failover', data: { from: 'claude', to: 'codex' } },
    { seq: 3, type: 'task.completed', data: { status: 'succeeded' } },
    { seq: 4, type: 'followup.accepted', data: {} },
    { seq: 5, type: 'task.interrupted', data: {} },
  ]);
  assert.equal(st.backend, 'codex');
  assert.equal(st.session_id, null);
  assert.equal(st.turn, 2);
  assert.equal(st.interruptions, 1);
});

test('failures: phan loai van ban', () => {
  assert.equal(classifyText('Error: 429 Too Many Requests'), 'rate_limited');
  assert.equal(classifyText('You have hit your usage limit'), 'rate_limited');
  assert.equal(classifyText('Not logged in. Please run /login'), 'auth');
  assert.equal(classifyText('authentication required'), 'auth');
  assert.equal(classifyText('Missing ANTHROPIC_API_KEY'), 'auth');
  assert.equal(classifyText('read ECONNRESET'), 'transient');
  assert.equal(classifyText("'codex' is not recognized as an internal or external command"), 'config');
  assert.equal(classifyText('all good'), null);
});

test('failures: thoi diem reset (B22)', () => {
  assert.equal(parseRetryAfterMs('try again in 30s'), 30_000);
  assert.equal(parseRetryAfterMs('retry in 2 minutes'), 120_000);
  assert.equal(parseRetryAfterMs('retry-after: 7'), 7000);
  const now = Date.parse('2026-11-16T10:00:00Z');
  assert.equal(parseRetryAfterMs('limit resets at 2026-11-16T10:05:00Z', now), 300_000);
  assert.equal(parseRetryAfterMs('Claude AI usage limit reached|' + Math.floor((now + 600_000) / 1000), now), 600_000);
  const local = new Date(now); local.setHours(15, 45, 0, 0);
  const expect = local.getTime() > now ? local.getTime() - now : local.getTime() + 86_400_000 - now;
  assert.equal(parseRetryAfterMs('You\'ve hit your usage limit. Try again at 3:45 PM.', now), expect);
});

test('failures: quyet dinh (gom no_output, crash sau resume, permission, cancelled)', () => {
  const ctx = { attempt: 1, maxAttempts: 3, hasSession: true, failoverCandidates: [] };
  assert.equal(decide({ class: 'crash' }, ctx).action, 'resume');
  assert.equal(decide({ class: 'crash' }, { ...ctx, lastMode: 'resume' }).action, 'retry', 'resume vua crash -> chay moi');
  assert.equal(decide({ class: 'crash' }, { ...ctx, hasSession: false }).action, 'retry');
  assert.equal(decide({ class: 'crash' }, { ...ctx, attempt: 3 }).action, 'fail');
  assert.equal(decide({ class: 'crash' }, { ...ctx, attempt: 3, failoverCandidates: ['codex'] }).action, 'failover');
  assert.equal(decide({ class: 'auth' }, ctx).action, 'park');
  assert.equal(decide({ class: 'auth' }, { ...ctx, failoverCandidates: ['codex'] }).action, 'failover');
  assert.equal(decide({ class: 'permission' }, ctx).action, 'park');
  assert.equal(decide({ class: 'cancelled' }, ctx).action, 'cancel');
  assert.equal(decide({ class: 'no_output' }, { ...ctx, classCount: 1 }).action, 'resume');
  assert.equal(decide({ class: 'no_output' }, { ...ctx, classCount: 2 }).action, 'fail');
  assert.equal(decide({ class: 'rate_limited', retryAfterMs: 10_000 }, ctx).action, 'resume');
  assert.equal(decide({ class: 'rate_limited', retryAfterMs: 3_600_000 }, { ...ctx, failoverCandidates: ['antigravity'] }).to, 'antigravity');
  assert.equal(decide({ class: 'agent_failed' }, ctx).action, 'fail');
  assert.equal(backoffMs(3, { base: 1000, rand: () => 1 }), 4000);
});

test('schema: trich JSON tu fence hoac object tran (ke ca dau ngoac trong chuoi)', () => {
  assert.deepEqual(extractJsonBlock('blah\n```json\n{"a":1}\n```\nend'), { a: 1 });
  assert.deepEqual(extractJsonBlock('ket qua: {"status":"succeeded","summary":"x"} xong'), { status: 'succeeded', summary: 'x' });
  assert.deepEqual(extractJsonBlock('xx {"summary":"dung } va { trong chuoi","status":"succeeded"} yy'), { summary: 'dung } va { trong chuoi', status: 'succeeded' });
  assert.deepEqual(extractJsonBlock('{"a":1} roi {"b":2}'), { b: 2 });
  assert.equal(extractJsonBlock('khong co json'), null);
});

test('schema: hop dong ket qua + output_schema + additionalProperties + summary rong', () => {
  const spec = normalizeSpec({ prompt: 'p', output_schema: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } }, additionalProperties: false } });
  assert.equal(parseFinalMessage(spec, '```json\n{"status":"succeeded","summary":"s","outputs":{"n":1}}\n```').ok, true);
  const bad = parseFinalMessage(spec, '```json\n{"status":"done","summary":"s","outputs":{"n":"x","z":1}}\n```');
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('status')));
  assert.ok(bad.errors.some((e) => e.includes('outputs.n')));
  assert.ok(bad.errors.some((e) => e.includes('outputs.z')));
  assert.equal(parseFinalMessage(spec, '{"status":"succeeded","summary":"  "}').ok, false, 'summary rong khong duoc chap nhan');
  // strict tra null cho truong tuy chon -> bo truoc khi validate
  assert.equal(parseFinalMessage(normalizeSpec({ prompt: 'p' }), '{"status":"succeeded","summary":"s","artifacts":null,"questions":null}').ok, true);
  assert.deepEqual(validate({ type: 'array', items: { type: 'string' } }, ['a', 1]), ['$[1]: can kieu string, nhan integer']);
});

// Bat bien strict: moi object co additionalProperties:false va required == tap khoa properties
function assertStrict(s, at = '$') {
  if (!s || typeof s !== 'object') return;
  const isObj = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'));
  if (isObj) {
    assert.equal(s.additionalProperties, false, `${at}: thieu additionalProperties:false`);
    assert.ok(s.properties, `${at}: object khong co properties`);
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${at}: required != properties`);
    for (const [k, v] of Object.entries(s.properties)) assertStrict(v, `${at}.${k}`);
  }
  if (s.items) assertStrict(s.items, `${at}[]`);
  for (const x of s.anyOf ?? []) assertStrict(x, `${at}|`);
}

test('schema strict cho Codex (B2): bat bien strict, description duoc phep, tuy chon = union null', () => {
  const plain = strictFinalSchema(normalizeSpec({ prompt: 'p' }));
  assertStrict(plain);
  assert.deepEqual(plain.properties.outputs, { type: ['object', 'null'], properties: {}, additionalProperties: false, required: [] }); // outputs khong required -> nullable
  const item = plain.properties.artifacts.anyOf ? plain.properties.artifacts.anyOf[0].items : plain.properties.artifacts.items;
  assert.ok(item.properties.description, 'artifacts.items phai cho phep description');
  assert.deepEqual(item.properties.description.type, ['string', 'null']);
  assert.deepEqual(plain.properties.artifacts.type, ['array', 'null']);
  assert.equal(plain.properties.status.type, 'string', 'truong required giu nguyen kieu');
  const user = { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'object', properties: { c: { type: 'number' } } }, e: { enum: ['x', 'y'] } } };
  const s2 = strictFinalSchema(normalizeSpec({ prompt: 'p', output_schema: user }));
  assertStrict(s2);
  assert.deepEqual(s2.properties.outputs.properties.b.type, ['object', 'null']);
  assert.deepEqual(s2.properties.outputs.properties.e.enum, ['x', 'y', null]);
  // object "bat ky" / dictionary khong bieu dien duoc o strict -> tat schema native cho task do
  assert.equal(isStrictable({ type: 'object' }), false);
  assert.equal(isStrictable({ type: 'object', properties: {}, additionalProperties: { type: 'string' } }), false);
  assert.equal(strictFinalSchema(normalizeSpec({ prompt: 'p', output_schema: { type: 'object' } })), null);
  assert.equal(strictify({ type: 'string', maxLength: 5 }).maxLength, undefined);
});

test('envelope (B5): succeeded => error null va summary khac rong', () => {
  assert.throws(() => makeEnvelope({ task_id: 't', backend: 'x', status: 'succeeded', summary: '', error: null }));
  assert.throws(() => makeEnvelope({ task_id: 't', backend: 'x', status: 'succeeded', summary: 's', error: { class: 'bad_output' } }));
  assert.equal(makeEnvelope({ task_id: 't', backend: 'x', status: 'failed', summary: '' }).status, 'failed');
});

test('mat tien (B19, B23): chi nhan truong cong khai; cwd bat buoc; fake chi khi ORCH_ENABLE_FAKE', () => {
  const p = pickPublicSpec({ prompt: 'p', cwd: 'C:/x', backend_options: { claude: { args: ['--dangerously-skip-permissions'] } }, limits: { max_attempts: 99 }, policy: { a: 1 } });
  assert.deepEqual(Object.keys(p).sort(), ['cwd', 'prompt']);
  assert.throws(() => normalizeSpec({ prompt: 'p' }, { requireCwd: true }), /cwd/);
  assert.throws(() => normalizeSpec({ prompt: 'p', access: 'admin' }), /access/);
  process.env.ORCH_ENABLE_FAKE = '0';
  try { assert.throws(() => normalizeSpec({ prompt: 'p', backend: 'fake' }), /backend/); } finally { process.env.ORCH_ENABLE_FAKE = '1'; }
});

test('schema: cat summary kem con tro', () => {
  const s = clampSummary('x'.repeat(1000), 300, 'ref.md');
  assert.ok(s.length <= 300);
  assert.ok(s.includes('ref.md'));
});
