// Adapter Claude Code headless (claude -p).
// Da kiem chung (code.claude.com/docs/en/headless + /mcp, 2026):
//   -p; prompt doc tu stdin (pipe, toi da 10MB); --output-format stream-json + --verbose; dong cuoi la su kien `result`
//   (result, session_id, is_error, total_cost_usd, usage, permission_denials); --json-schema -> structured_output (voi json);
//   --resume <session_id>; system/init; system/api_retry{error in authentication_failed|rate_limit|overloaded|billing_error|server_error..};
//   SIGTERM -> exit 143; --strict-mcp-config + --mcp-config; --permission-prompts none; --bare KHONG dung OAuth (can API key)
//   va tai lieu noi --bare "se thanh mac dinh cua -p" (rui ro R-bare, B24a).
// GIA DINH: structured_output co trong `result` khi stream-json; tool_result nam trong message `user` voi tool_use_id.
import { tryJson } from './base.mjs';
import { classifyText, parseRetryAfterMs } from '../failures.mjs';
import { finalMessageSchema } from '../schema.mjs';

const API_RETRY_CLASS = {
  authentication_failed: 'auth', oauth_org_not_allowed: 'auth', account_on_hold: 'auth', billing_error: 'rate_limited',
  rate_limit: 'rate_limited', overloaded: 'transient', server_error: 'transient', cloud_credential_error: 'auth',
  model_not_found: 'config', invalid_request: 'config',
};

export function createClaudeAdapter(opts = {}) {
  const command = opts.command ?? process.env.ORCH_CLAUDE_CMD ?? 'claude';
  return {
    id: 'claude',
    // nativeSchema mac dinh TAT (B20.1): --json-schema di qua argv (JSON co dau ") - chi bat khi lenh duoc phan giai
    // thanh node-shim/exe (khong qua cmd.exe). Hop dong trong prompt + validator + repair la duong chinh.
    capabilities: { stream: true, resume: true, nativeSchema: !!opts.nativeSchema, nativeSubagents: true },
    knownTypes: new Set(['system', 'assistant', 'user', 'result', 'stream_event', 'control_request', 'control_response']), // D7 canary

    buildInvocation({ spec, prompt, sessionId, extraArgs = [], workerMcpConfig }) {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'none'];
      // Worker KHONG thay hub (chong de quy). Khong dung --bare vi --bare bo dang nhap subscription.
      args.push('--strict-mcp-config');
      if (workerMcpConfig) args.push('--mcp-config', workerMcpConfig);
      if (sessionId) args.push('--resume', sessionId);
      if (spec.model) args.push('--model', spec.model);
      if (opts.nativeSchema) args.push('--json-schema', JSON.stringify(finalMessageSchema(spec)));
      args.push(...(spec.backend_options?.claude?.args ?? []), ...extraArgs);
      return { command, args, stdin: prompt, cwd: spec.cwd, env: {} };
    },

    parseLine(line, acc) {
      const j = tryJson(line);
      if (!j) return [];
      const out = [];
      if (j.session_id && j.session_id !== acc.session_id) {
        acc.session_id = j.session_id;
        out.push({ kind: 'session', session_id: j.session_id });
      }
      if (j.type === 'system' && j.subtype === 'api_retry') {
        acc.lastApiRetry = j; // chi co nghia neu la tin hieu CUOI truoc khi that bai (B22)
        out.push({ kind: 'progress', text: `api_retry ${j.error} attempt ${j.attempt}/${j.max_retries} (+${j.retry_delay_ms}ms)` });
      } else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
        acc.lastApiRetry = null; // model da tra loi -> lan retry truoc da thanh cong
        if (!j.parent_tool_use_id) {
          for (const c of j.message.content) {
            if (c.type === 'text' && c.text) { acc.lastText = c.text; out.push({ kind: 'progress', text: c.text.slice(0, 300) }); }
            if (c.type === 'tool_use') out.push({ kind: 'tool_start', id: c.id, name: c.name });
          }
        }
      } else if (j.type === 'user' && Array.isArray(j.message?.content) && !j.parent_tool_use_id) {
        for (const c of j.message.content) if (c.type === 'tool_result') out.push({ kind: 'tool_end', id: c.tool_use_id });
      } else if (j.type === 'result') {
        const text = j.structured_output
          ? '```json\n' + JSON.stringify(j.structured_output) + '\n```'
          : typeof j.result === 'string' ? j.result : acc.lastText ?? '';
        if (Array.isArray(j.permission_denials) && j.permission_denials.length) {
          acc.denials = j.permission_denials.map((d) => ({ tool: d.tool_name ?? d.tool ?? null, detail: d.tool_input ? JSON.stringify(d.tool_input).slice(0, 200) : null }));
        }
        out.push({
          kind: 'final',
          text,
          is_error: !!j.is_error || (j.subtype && j.subtype !== 'success'),
          usage: { ...(j.usage ?? {}), cost_usd: j.total_cost_usd ?? null, cost_is_cumulative: !!acc.resumed, num_turns: j.num_turns ?? null, duration_ms: j.duration_ms ?? null },
        });
      }
      return out;
    },

    classifyExit({ code, stderrTail, acc }) {
      const r = acc.lastApiRetry;
      const text = `${stderrTail}\n${acc.errorText ?? ''}\n${acc.final?.is_error ? acc.final.text : ''}`;
      if ((code !== 0 || acc.final?.is_error || !acc.final) && r && API_RETRY_CLASS[r.error]) {
        // retry_delay_ms la backoff noi bo, KHONG phai thoi diem reset quota -> chi dung thong bao text neu co (B22)
        return { class: API_RETRY_CLASS[r.error], message: `api_retry:${r.error} status ${r.error_status}`, retryAfterMs: parseRetryAfterMs(text) };
      }
      if (code === 143) return { class: 'crash', message: 'SIGTERM (143): turn dang chay khong duoc ghi; resume se tiep tuc' };
      const cls = classifyText(text);
      if (cls === 'auth' && /api[_ ]?key/i.test(text)) {
        return { class: 'auth', message: `${text.trim().slice(-300)} | Goi y: worker 'claude -p' doi API key - co the --bare da thanh mac dinh cua -p (rui ro R-bare). Dat ANTHROPIC_API_KEY qua policy hoac chuyen driver.` };
      }
      if (cls) return { class: cls, message: text.trim().slice(-500), retryAfterMs: parseRetryAfterMs(text) };
      if (acc.final?.is_error) return { class: 'crash', message: `result is_error: ${String(acc.final.text).slice(0, 300)}` };
      if (code !== 0) return { class: 'crash', message: `exit ${code}: ${stderrTail.slice(-300)}` };
      return null;
    },
  };
}
