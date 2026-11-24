// Adapter Codex CLI headless (codex exec).
// Da kiem chung (learn.chatgpt.com/docs/non-interactive-mode, 2026): `codex exec -` doc prompt tu stdin; --json -> JSONL
// (thread.started{thread_id}, turn.started, turn.completed{usage}, turn.failed, item.started/item.completed, error);
// --output-schema <file>; -o/--output-last-message <file>; `codex exec resume <SESSION_ID>`; --sandbox; --skip-git-repo-check.
// [DKC notebook r2] --output-schema dung Strict Structured Outputs (moi object additionalProperties:false, moi property required,
// truong tuy chon = union null); schema sai -> tu choi truoc khi suy luan. Luot bi tu choi (refused turn) van exit 0 (#56875).
// GIA DINH: resume nhan '-' va --json/--output-schema; item.type 'agent_message' + item.text; item.started co item.id cho tool;
// noi dung loi khi schema bi tu choi co chu "schema"/"response_format"; exit code khi loi (tai lieu khong neu).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryJson } from './base.mjs';
import { classifyText, parseRetryAfterMs } from '../failures.mjs';
import { strictFinalSchema } from '../schema.mjs';

const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'patch_apply', 'local_shell_call']);

/** D3: ten (khoa TOML bare key) GOI Y cua muc subagent-hub; chi duoc dung khi muc do THUC SU co trong config (r3.1 F4). */
export function hubServerNames(override, env = process.env) {
  const raw = override ?? env.ORCH_CODEX_HUB_NAMES ?? 'subagent-hub';
  return String(raw).split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]+$/.test(s));
}

/**
 * Cac file config.toml Codex THUC SU nap: $CODEX_HOME/config.toml (mac dinh ~/.codex) + .codex/config.toml cua du an tu cwd
 * di len toi thu muc co .git (goc du an), khong vuot qua thu muc home.
 * [DKC notebook r3.1, Configuration Reference] lop .codex/ cua du an "Loaded only when the project is trusted" -> chi tinh lop du an
 * khi config user co [projects."<P>"] trust_level = "trusted" voi P la cwd hoac to tien cua cwd. Khong chac -> KHONG tinh:
 * thieu -c (worker nap hub) chi ton mot lop chan de quy (to tien), con -c cho muc khong duoc nap -> codex exec hong ngay (F4).
 */
export function codexConfigFiles(cwd, env = process.env) {
  const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
  const home = env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const userFile = path.join(home, 'config.toml');
  const files = [userFile];
  if (cwd) {
    let userText = ''; try { userText = fs.readFileSync(userFile, 'utf8'); } catch {}
    const trusted = trustedProjects(userText).map(real);
    const isTrusted = (d) => { const r = real(d); return trusted.some((t) => r === t || r.startsWith(t.endsWith(path.sep) ? t : t + path.sep)); };
    const stop = real(env.USERPROFILE || os.homedir());
    let d = path.resolve(cwd);
    for (let i = 0; i < 64; i++) {
      if (real(d) === stop) break;
      const f = path.join(d, '.codex', 'config.toml');
      if (isTrusted(d) && !files.some((x) => real(x) === real(f))) files.push(f);
      if (fs.existsSync(path.join(d, '.git'))) break;
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return files.filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
}

/** Duong dan trong [projects."<P>"] co trust_level = "trusted" (TOML basic string: \\ -> \; literal '...': giu nguyen). */
export function trustedProjects(text) {
  const out = []; let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const h = /^\s*\[\s*projects\s*\.\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*\]/.exec(line);
    if (h) { cur = h[1] != null ? h[1].replace(/\\(.)/g, '$1') : h[2]; continue; }
    if (/^\s*\[/.test(line)) { cur = null; continue; }
    if (cur && /^\s*trust_level\s*=\s*["']trusted["']/.test(line)) out.push(cur);
  }
  return out;
}

/**
 * Doc TOML TOI THIEU (khong dependency): tra Map ten -> van ban cua muc mcp_servers.<ten>.
 * Ho tro: [mcp_servers.ten] / [mcp_servers."ten"] (+ bang con [mcp_servers.ten.env]), khoa cham
 * `mcp_servers.ten.command = ...` o goc, va bang inline `ten = { ... }` duoi [mcp_servers].
 */
export function parseMcpServers(text) {
  const out = new Map();
  const add = (name, t) => out.set(name, (out.get(name) ?? '') + t + '\n');
  const KEY = String.raw`(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))`;
  const header = new RegExp(String.raw`^\s*\[\s*mcp_servers\s*\.\s*` + KEY + String.raw`\s*(?:\.[^\]]*)?\]`);
  const dotted = new RegExp(String.raw`^\s*mcp_servers\s*\.\s*` + KEY + String.raw`\s*\.`);
  const inline = new RegExp(String.raw`^\s*` + KEY + String.raw`\s*=\s*\{`);
  let cur = null; // ten muc dang mo | '' = dang o [mcp_servers] | null = bang khac
  let atRoot = true;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '');
    if (/^\s*\[/.test(line)) {
      atRoot = false;
      const h = header.exec(line);
      if (h) { cur = h[1] ?? h[2] ?? h[3]; add(cur, line); continue; }
      cur = /^\s*\[\s*mcp_servers\s*\]/.test(line) ? '' : null;
      continue;
    }
    if (cur) { add(cur, line); continue; }
    if (cur === '') { const m = inline.exec(line); if (m) add(m[1] ?? m[2] ?? m[3], line); continue; }
    if (atRoot) { const m = dotted.exec(line); if (m) add(m[1] ?? m[2] ?? m[3], line); }
  }
  return out;
}

/**
 * r3.1 (F4/M4): muc subagent-hub THUC SU co trong config Codex. -c mcp_servers.<ten>.enabled=false cho ten KHONG co trong config
 * se tao muc thieu command/url -> codex exec co the hong ngay tu dau; nen chi tra cac ten co that va:
 *   (a) ten nam trong ORCH_CODEX_HUB_NAMES (mac dinh subagent-hub), hoac
 *   (b) command/args cua muc tro toi mcp-server.mjs cua he nay (ten tuy y nguoi dung dat).
 * Ten ngoai [A-Za-z0-9_-] bi bo (khong quote duoc an toan qua -c). Loi doc file -> bo qua file do.
 * @returns {{names: string[], files: string[], skipped: string[]}}
 */
export function codexHubEntries({ cwd, env = process.env, hubNames } = {}) {
  const wanted = new Set(hubNames ?? hubServerNames(undefined, env));
  const names = new Set(); const skipped = []; const files = codexConfigFiles(cwd, env);
  for (const f of files) {
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const [name, body] of parseMcpServers(text)) {
      if (!(wanted.has(name) || /mcp-server\.mjs/i.test(body))) continue;
      if (/^[A-Za-z0-9_-]+$/.test(name)) names.add(name); else skipped.push(name);
    }
  }
  return { names: [...names], files, skipped };
}

export function createCodexAdapter(opts = {}) {
  const command = opts.command ?? process.env.ORCH_CODEX_CMD ?? 'codex';
  return {
    id: 'codex',
    capabilities: { stream: true, resume: true, nativeSchema: true, nativeSubagents: true },
    // D7 (r3) canary: loai su kien da biet; dong JSON co type ngoai danh sach -> warnings unknown_events (doi format backend)
    knownTypes: new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']),

    buildInvocation({ spec, prompt, sessionId, attemptDir, extraArgs = [], nativeSchemaOff = false }) {
      const lastMsg = path.join(attemptDir, 'last-message.txt');
      const args = ['exec'];
      if (sessionId) args.push('resume', sessionId);
      args.push('--json', '-o', lastMsg);
      if (!sessionId) args.push('-C', spec.cwd, '--skip-git-repo-check');
      let usedNativeSchema = false;
      const strict = opts.nativeSchema === false || nativeSchemaOff ? null : strictFinalSchema(spec);
      if (strict) {
        // Schema di qua FILE (khong qua argv -> khong lo quoting). Validator cua hub van chay lai.
        const schemaFile = path.join(attemptDir, 'final-schema.json');
        fs.writeFileSync(schemaFile, JSON.stringify(strict));
        args.push('--output-schema', schemaFile);
        usedNativeSchema = true;
      }
      if (spec.model) args.push('-m', spec.model);
      // D3 (r3): worker Codex KHONG duoc nap lai subagent-hub (de quy). ORCH_DEPTH khong toi duoc MCP stdio cua worker vi Codex
      // env_clear() roi chi nap DEFAULT_ENV_VARS [DKC notebook r3] -> tat han server bang khoa cau hinh mcp_servers.<id>.enabled
      // ("Disable an MCP server without removing its configuration", Configuration Reference) qua -c (exec chap nhan -c).
      // r3.1 (F4): CHI cho muc co that trong config.toml (user + du an); xem codexHubEntries. opts.hubEntries de test ep danh sach.
      const hub = opts.hubEntries ?? codexHubEntries({ cwd: spec.cwd, env: opts.env ?? process.env, hubNames: opts.hubNames != null ? hubServerNames(opts.hubNames) : undefined }).names;
      for (const name of hub) args.push('-c', `mcp_servers.${name}.enabled=false`);
      // --sandbox / approval do policy hook chen vao extraArgs (mac dinh Codex la read-only). backend_options KHONG nhan tu MCP.
      args.push(...(spec.backend_options?.codex?.args ?? []), ...extraArgs, '-');
      return { command, args, stdin: prompt, cwd: spec.cwd, env: {}, lastMessageFile: lastMsg, usedNativeSchema };
    },

    parseLine(line, acc) {
      const j = tryJson(line);
      if (!j) return [];
      const out = [];
      switch (j.type) {
        case 'thread.started':
          if (j.thread_id) { acc.session_id = j.thread_id; out.push({ kind: 'session', session_id: j.thread_id }); }
          break;
        case 'item.started': {
          const it = j.item ?? {};
          if (TOOL_ITEMS.has(it.type)) out.push({ kind: 'tool_start', id: it.id ?? `${it.type}-${Date.now()}`, name: it.type });
          break;
        }
        case 'item.completed': {
          const it = j.item ?? {};
          if (it.type === 'agent_message' && typeof it.text === 'string') { acc.lastText = it.text; out.push({ kind: 'progress', text: it.text.slice(0, 300) }); }
          else if (it.type) {
            out.push({ kind: 'tool_end', id: it.id, name: it.type });
            if (it.status === 'declined' || it.status === 'rejected') (acc.denials ??= []).push({ tool: it.type, detail: it.command ?? it.server ?? null });
          }
          break;
        }
        case 'turn.completed':
          acc.usage = j.usage ?? null;
          out.push({ kind: 'final', text: acc.lastText ?? '', is_error: false, usage: j.usage ?? {} });
          break;
        case 'turn.failed':
          out.push({ kind: 'error', text: JSON.stringify(j.error ?? j).slice(0, 2000) });
          break;
        case 'error':
          out.push({ kind: 'error', text: String(j.message ?? JSON.stringify(j)).slice(0, 2000) });
          break;
        default: break;
      }
      return out;
    },

    finalize(acc, inv) {
      try { const t = fs.readFileSync(inv.lastMessageFile, 'utf8'); if (t.trim()) return { text: t }; } catch {}
      return null;
    },

    classifyExit({ code, stderrTail, acc, inv }) {
      const text = `${stderrTail}\n${acc.errorText ?? ''}`;
      if (inv?.usedNativeSchema && /(output.?schema|json.?schema|response_format|invalid_json_schema|strict)/i.test(text) && /(invalid|unsupported|not (allowed|permitted|supported)|must|required)/i.test(text)) {
        return { class: 'config', schemaRejected: true, message: `schema native bi tu choi: ${text.trim().slice(-300)}` };
      }
      const cls = classifyText(text);
      if (cls) return { class: cls, message: text.trim().slice(-500), retryAfterMs: parseRetryAfterMs(text) };
      if (acc.errorText) return { class: 'crash', message: acc.errorText.slice(0, 500) };
      if (code !== 0) return { class: 'crash', message: `exit ${code}: ${stderrTail.slice(-300)}` };
      return null;
    },
  };
}
