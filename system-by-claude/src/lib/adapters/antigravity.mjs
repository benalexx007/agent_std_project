// Adapter Antigravity CLI (agy) headless.
// Da kiem chung (antigravity.google/docs/cli/headless, 2026): `agy -p`, --output-format stream-json, --input-format stream-json
// (dong stdin {"event":"user","message":{"content":"..."}}), --json-schema, --conversation <id>, --print-timeout;
// su kien `event`: init | step_update | result; result co conversation_id, status
// (SUCCESS|ERROR|CANCELED|INTERRUPTED|INVALID|WAITING|RUNNING), response, error, usage, structured_output, finished_reason.
// [DKC notebook r2]: exit 0 ok | 1 cau hinh/co sai/schema sai | 2 loi dung print-mode (vd gui control_request) | 3 loi API/model
//   -> stderr co dong `AGY_ERROR: {"canonical_status":"RESOURCE_EXHAUSTED","error_code":429,"retryable":false,...}`.
//   Dong stdin (EOF): agy hoan tat turn hien tai, phat `result`, exit 0 -> dong stdin ngay sau dong `user` la DUNG.
//   Khong co lenh huy qua stdin (control_request -> exit 2); huy = tin hieu OS (SIGINT -> INTERRUPTED). Issue #76 da sua (v1.1.13+/v1.4.11).
// GIA DINH: hinh dang step_update cho tool (step_type 'tool', state, step id) -> chi dung de do "tool dang chay".
import { tryJson } from './base.mjs';
import { classifyText, parseRetryAfterMs } from '../failures.mjs';

const CANONICAL = {
  RESOURCE_EXHAUSTED: 'rate_limited', UNAUTHENTICATED: 'auth', PERMISSION_DENIED: 'auth', UNAVAILABLE: 'transient',
  DEADLINE_EXCEEDED: 'transient', INTERNAL: 'transient', ABORTED: 'transient', INVALID_ARGUMENT: 'config',
  FAILED_PRECONDITION: 'config', NOT_FOUND: 'config', CANCELLED: 'cancelled',
};

export function parseAgyError(stderr) {
  const m = /AGY_ERROR:\s*(\{.*\})/.exec(stderr ?? '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export function createAntigravityAdapter(opts = {}) {
  const command = opts.command ?? process.env.ORCH_ANTIGRAVITY_CMD ?? 'agy';
  return {
    id: 'antigravity',
    capabilities: { stream: true, resume: true, nativeSchema: false, nativeSubagents: true }, // --json-schema chua bat (B20.1)
    knownTypes: new Set(['step_update', 'result']), // D7 canary (truong 'event'); GIA DINH: agy khong co loai su kien thuong xuyen nao khac

    buildInvocation({ spec, prompt, sessionId, extraArgs = [] }) {
      const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json'];
      if (sessionId) args.push('--conversation', sessionId);
      if (spec.model) args.push('--model', spec.model);
      args.push(...(spec.backend_options?.antigravity?.args ?? []), ...extraArgs);
      const stdin = JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
      return { command, args, stdin, cwd: spec.cwd, env: {} };
    },

    parseLine(line, acc) {
      const j = tryJson(line);
      if (!j) return [];
      const out = [];
      if (j.conversation_id && j.conversation_id !== acc.session_id) {
        acc.session_id = j.conversation_id;
        out.push({ kind: 'session', session_id: j.conversation_id });
      }
      if (j.event === 'step_update') {
        if (j.text_delta) acc.buf = (acc.buf ?? '') + j.text_delta;
        if (j.step_type === 'tool') {
          const id = j.step_id ?? j.step_index ?? j.tool_info?.id ?? j.tool_name;
          out.push({ kind: j.state === 'DONE' || j.state === 'ERROR' ? 'tool_end' : 'tool_start', id, name: j.tool_name ?? j.tool_info?.name ?? 'tool' });
        }
        if (j.step_type === 'agent_response' && j.state === 'DONE' && acc.buf) { acc.lastText = acc.buf; out.push({ kind: 'progress', text: acc.buf.slice(-300) }); acc.buf = ''; }
        if (j.tool_info?.error) out.push({ kind: 'error', text: `${j.tool_info.error.type}: ${j.tool_info.error.message}` });
      } else if (j.event === 'result') {
        const ok = j.status === 'SUCCESS';
        const text = j.structured_output ? '```json\n' + JSON.stringify(j.structured_output) + '\n```' : (j.response ?? acc.lastText ?? '');
        if (!ok && j.error) acc.errorText = typeof j.error === 'string' ? j.error : JSON.stringify(j.error);
        out.push({ kind: 'final', text, is_error: !ok, status: j.status, finished_reason: j.finished_reason ?? null, usage: j.usage ?? {} });
      }
      return out;
    },

    classifyExit({ code, stderrTail, acc }) {
      const st = acc.final?.status;
      if (st === 'CANCELED') return { class: 'cancelled', message: 'backend CANCELED' };
      if (st === 'WAITING') return { class: 'permission', message: 'agy dung o WAITING: cho duyet quyen/cau hoi chua duoc cap truoc' };
      if (st === 'INVALID') return { class: 'config', message: `agy INVALID: ${acc.errorText ?? ''}`.slice(0, 500) };
      const agy = parseAgyError(stderrTail);
      if (agy) {
        const cls = CANONICAL[agy.canonical_status] ?? (agy.error_code === 429 ? 'rate_limited' : agy.retryable ? 'transient' : 'crash');
        return { class: cls, message: `AGY_ERROR ${agy.canonical_status ?? ''} ${agy.error_code ?? ''} ${agy.error_id ?? ''}`.trim(), retryAfterMs: parseRetryAfterMs(stderrTail) };
      }
      const text = `${stderrTail}\n${acc.errorText ?? ''}`;
      const cls = classifyText(text);
      if (cls) return { class: cls, message: text.trim().slice(-500), retryAfterMs: parseRetryAfterMs(text) };
      if (code === 1 || code === 2) return { class: 'config', message: `agy exit ${code} (co/cau hinh sai): ${stderrTail.slice(-300)}` };
      if (st === 'INTERRUPTED') return { class: 'crash', message: 'agy INTERRUPTED' };
      if (acc.final?.is_error) return { class: 'crash', message: `status ${st}: ${acc.errorText ?? ''}`.slice(0, 500) };
      if (code !== 0) return { class: 'crash', message: `exit ${code}: ${stderrTail.slice(-300)}` };
      return null;
    },
  };
}
