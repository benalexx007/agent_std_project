#!/usr/bin/env node
// Backend gia lap de test lop loi va vong doi ma khong can backend that.
// Dung: node fake-backend.mjs --scenario <ten> --state <dir> [--resume <sid>]   (prompt qua stdin)
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const scenario = arg('--scenario') ?? 'ok';
const stateDir = arg('--state') ?? '.';
const resume = arg('--resume');
const counterFile = path.join(stateDir, `fake-${scenario}.count`);
let n = 0;
try { n = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0; } catch {}
n += 1;
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(counterFile, String(n));
fs.appendFileSync(path.join(stateDir, 'fake-pids.log'), `${process.pid} ${scenario} ${n}\n`);

const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sid = resume ?? `fake-sess-${Date.now()}`;
const contract = (status = 'succeeded', extra = {}) =>
  '```json\n' + JSON.stringify({ status, summary: `fake ${scenario} lan ${n}`, outputs: { n }, artifacts: [], changed_files: [], ...extra }) + '\n```';

let prompt = '';
process.stdin.on('data', (d) => { prompt += d; });
process.stdin.on('end', main);

async function main() {
  emit({ type: 'session', id: sid });
  switch (scenario) {
    case 'grandchild': { // r3 N5/Q10: tool chay nen qua `cmd /c start /b` -> "chau" mat cha, thoat khoi job SILENT_BREAKAWAY cua libuv
      const { spawn } = await import('node:child_process');
      const pidFile = path.join(stateDir, 'grandchild.pid');
      const code = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(()=>{}, 120000)`;
      const js = path.join(stateDir, 'grandchild.js');
      fs.writeFileSync(js, code);
      spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"start "" /b "${process.execPath}" "${js}""`], { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
      for (let i = 0; i < 600; i++) { emit({ type: 'progress', text: `buoc ${i}` }); await sleep(100); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    }
    case 'write_then_hang': // D2: sua workspace roi chay tiep -> bi huy giua chung
      fs.writeFileSync(path.join(process.cwd(), 'dang-do.txt'), 'nua chung');
      for (let i = 0; i < 600; i++) { emit({ type: 'progress', text: `buoc ${i}` }); await sleep(100); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'format_changed': // D7: backend doi format (ten su kien moi), thoat 0, khong co su kien final ma parser biet
      emit({ type: 'message.v2', text: 'xin chao' });
      emit({ type: 'turn.done.v2', result: contract() });
      return process.exit(0);
    case 'unknown_extra': // D7: them loai su kien la nhung van co final -> succeeded + warnings unknown_events
      emit({ type: 'telemetry.new', x: 1 });
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'progress_burst': // r3.1 M10: progress cuoi chua flush (gop 1s) luc backend thoat
      emit({ type: 'progress', text: 'p-dau' });
      emit({ type: 'progress', text: 'p-cuoi' });
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'ok':
      emit({ type: 'progress', text: 'dang lam' });
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'slow':
      for (let i = 0; i < 6; i++) { emit({ type: 'progress', text: `buoc ${i}` }); await sleep(250); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'very_slow': // dung cho test tiep quan: song lau
      for (let i = 0; i < 600; i++) { emit({ type: 'progress', text: `buoc ${i}` }); await sleep(100); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'bad_output_once':
      if (!resume) { emit({ type: 'final', text: 'Xong roi! (khong co JSON)' }); return process.exit(0); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'bad_output_always':
      emit({ type: 'final', text: 'Toi da sua xong loi o file a.js nhung khong theo hop dong.' });
      return process.exit(0);
    case 'silent': // thoat 0, khong in gi (agy #76 / soft-deny / refused turn)
      process.stdout.write('');
      return process.exit(0);
    case 'silent_once':
      if (n === 1) return process.exit(0);
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'crash_once':
      if (n === 1) { process.stderr.write('fatal: segmentation fault\n'); return process.exit(3); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'crash_always':
      process.stderr.write('fatal: segmentation fault\n');
      return process.exit(3);
    case 'rate_limit_once':
      if (n === 1) { process.stderr.write('Error 429: rate limit exceeded, try again in 1s\n'); return process.exit(1); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'auth':
      process.stderr.write('Not logged in. Please run login.\n');
      return process.exit(1);
    case 'hang':
      if (n === 1) { await sleep(60_000); return process.exit(0); }
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'long_tool': // tool im lang lau hon idle_timeout nhung ngan hon tool_idle_timeout (B15)
      emit({ type: 'tool_start', id: 'tu1', name: 'bash' });
      await sleep(1500);
      emit({ type: 'tool_end', id: 'tu1' });
      emit({ type: 'final', text: contract() });
      return process.exit(0);
    case 'agent_failed':
      emit({ type: 'final', text: contract('failed') });
      return process.exit(0);
    case 'denied':
      emit({ type: 'final', text: contract(), denials: [{ tool: 'Write', detail: 'a.txt' }] });
      return process.exit(0);
    case 'echo_prompt':
      emit({ type: 'final', text: contract('succeeded', { outputs: { prompt_len: prompt.length, resumed: !!resume, prompt_tail: prompt.slice(0, 80) } }) });
      return process.exit(0);
    default:
      process.stderr.write(`unknown scenario ${scenario}\n`);
      return process.exit(2);
  }
}
