// Adapter cho backend gia lap (test/fixtures/fake-backend.mjs). Cung giao dien voi adapter that.
// Chi co trong defaultAdapters() khi ORCH_ENABLE_FAKE=1 (B24/C7) - ban phat hanh khong lo backend gia.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tryJson } from './base.mjs';
import { classifyText, parseRetryAfterMs } from '../failures.mjs';

const FAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/fake-backend.mjs');

export function createFakeAdapter(opts = {}) {
  const id = opts.id ?? 'fake';
  return {
    id,
    capabilities: { stream: true, resume: true, nativeSchema: false, nativeSubagents: false },
    knownTypes: new Set(['session', 'progress', 'tool_start', 'tool_end', 'final']),
    buildInvocation({ spec, prompt, sessionId, attemptDir }) {
      const scenario = spec.backend_options?.[id]?.scenario ?? opts.scenario ?? 'ok';
      const stateDir = path.resolve(attemptDir, '..', '..');
      const args = [FAKE, '--scenario', scenario, '--state', stateDir];
      if (sessionId) args.push('--resume', sessionId);
      return { command: process.execPath, args, stdin: prompt, cwd: spec.cwd, env: {} };
    },
    parseLine(line, acc) {
      const j = tryJson(line);
      if (!j) return [];
      if (j.type === 'session') { acc.session_id = j.id; return [{ kind: 'session', session_id: j.id }]; }
      if (j.type === 'progress') return [{ kind: 'progress', text: j.text }];
      if (j.type === 'tool_start') return [{ kind: 'tool_start', id: j.id, name: j.name ?? 'tool' }];
      if (j.type === 'tool_end') return [{ kind: 'tool_end', id: j.id }];
      if (j.type === 'final') {
        if (j.denials) acc.denials = j.denials;
        return [{ kind: 'final', text: j.text, is_error: false, usage: { fake: true } }];
      }
      return [];
    },
    classifyExit({ code, stderrTail }) {
      const cls = classifyText(stderrTail);
      if (cls) return { class: cls, message: stderrTail.trim(), retryAfterMs: parseRetryAfterMs(stderrTail) };
      if (code !== 0) return { class: 'crash', message: `exit ${code}: ${stderrTail.trim()}` };
      return null;
    },
  };
}
