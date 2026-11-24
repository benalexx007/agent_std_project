#!/usr/bin/env node
// CLI mong cho nguoi dung va cho hook/lenh nen cua orchestrator.
//   orch spawn --backend codex --prompt "..." --cwd <dir> [--access write] [--title t] [--run r] [--key k] [--failover claude,antigravity]
//   orch run ... [--wait-ms 30000]
//   orch status <id> | orch wait <id...> [--all] [--timeout ms] [--min-turn n | --until-followup fid] [--until-done [--deadline ms]] | orch result <id> [--view summary|full|events]
//   orch cancel <id> | orch followup <id> --prompt "..." | orch resume <id> | orch list [--active] | orch reconcile
//   orch inbox [--hook] [--consumer c] [--cwd d | --all] [--run r] [--json]   (hook UserPromptSubmit/SessionStart; luon exit 0)
//   orch doctor
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Hub } from '../lib/hub.mjs';
import { normCwd, cwdWithin } from '../lib/store.mjs';
import { doctor } from '../lib/doctor.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    flags[k] = v;
  } else pos.push(rest[i]);
}
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
const promptOf = () => (flags['prompt-file'] ? fs.readFileSync(flags['prompt-file'], 'utf8') : flags.prompt);
const specOf = () => ({
  prompt: promptOf(), backend: flags.backend ?? 'auto', title: flags.title, run_id: flags.run, access: flags.access,
  idempotency_key: flags.key, failover: flags.failover ? String(flags.failover).split(',') : [], cwd: flags.cwd ?? process.cwd(),
});

function readStdinJson(ms) {
  if (process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => { process.stdin.pause(); resolve(tryParse(buf)); }, ms);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(tryParse(buf)); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(null); });
  });
}
function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function inbox(hub) {
  // B6: KHONG chay trong worker (hook cua project van chay trong `claude -p`/`codex exec` cua subagent).
  if ((parseInt(process.env.ORCH_DEPTH ?? '0', 10) || 0) > 0 || process.env.ORCH_PARENT_TASK) return;
  let consumer = typeof flags.consumer === 'string' ? flags.consumer : null;
  let cwd = typeof flags.cwd === 'string' ? flags.cwd : null;
  if (flags.hook) {
    const j = await readStdinJson(800);
    consumer ??= j?.session_id ?? j?.conversationId ?? j?.conversation_id ?? null; // Claude/Codex: session_id; agy: conversationId
    cwd ??= j?.cwd ?? j?.workspace ?? null; // Claude/Codex: cwd trong stdin; Codex chay hook voi cwd = cwd cua phien
  }
  cwd ??= process.cwd();
  // N6 (r3): store theo nguoi dung -> chi bao task cua project nay (task.cwd nam trong cwd cua phien), tru khi --all.
  // Khong co session id -> consumer gan voi cwd (khong de hai project dung chung 'default' an mat thong bao cua nhau).
  consumer ??= `default@${crypto.createHash('sha256').update(normCwd(cwd)).digest('hex').slice(0, 12)}`;
  const run = typeof flags.run === 'string' ? flags.run : null;
  const filter = (n) => (!run || n.run_id === run) && (flags.all || !n.cwd || cwdWithin(n.cwd, cwd));
  const items = await hub.notifications(consumer, { filter });
  if (flags.json) return out(items);
  if (items.length) {
    process.stdout.write(items.map((i) => `[subagent-hub] ${i.task_id} ${i.status}${i.turn > 1 ? ` (turn ${i.turn})` : ''}`
      + `${i.summary_head ? ': ' + i.summary_head.replace(/\s+/g, ' ').slice(0, 120) : ''}${i.status === 'needs_attention' ? ` -> ${i.reason ?? ''}; subagent_resume` : ''}`).join('\n') + '\n');
  }
}

let hub;
try {
  hub = new Hub({ root: flags.root });
  switch (cmd) {
    case 'spawn': out(await hub.spawn(specOf())); break;
    case 'run': out(await hub.run(specOf(), { wait_ms: flags['wait-ms'] ? +flags['wait-ms'] : 30_000 })); break;
    case 'status': out(await hub.status(pos[0])); break;
    case 'wait': {
      const o = { mode: flags.all ? 'all' : 'any', timeoutMs: flags.timeout ? +flags.timeout : 45_000, min_turn: flags['min-turn'] ? +flags['min-turn'] : null,
        until_followup: typeof flags['until-followup'] === 'string' ? flags['until-followup'] : null };
      let w = await hub.wait(pos, o);
      // --until-done: dung cho "Bash chay nen" cua Claude Code -> khi lenh ket thuc, Claude tu mo luot moi (B7b)
      // r3 (N3): co HAN (mac dinh 2h, --deadline <ms>) - runner_failed cung tinh la xong -> lenh nen khong bao gio treo vo han.
      const deadlineMs = flags.deadline ? +flags.deadline : 2 * 3600_000;
      const until = Date.now() + deadlineMs;
      while (flags['until-done'] && w.timed_out && Date.now() < until) w = await hub.wait(pos, { ...o, timeoutMs: Math.min(o.timeoutMs, Math.max(1000, until - Date.now())) });
      if (flags['until-done'] && w.timed_out) w = { ...w, deadline_exceeded: true, deadline_ms: deadlineMs };
      out(w);
      break;
    }
    case 'result': out(hub.result(pos[0], { view: flags.view ?? 'summary' })); break;
    case 'cancel': out(await hub.cancel(pos[0])); break;
    case 'followup': out(await hub.followup(pos[0], promptOf())); break;
    case 'resume': out(await hub.resume(pos[0])); break;
    case 'list': out(await hub.list({ active_only: !!flags.active, run_id: flags.run ?? null })); break;
    case 'reconcile': out(await hub.reconcile()); break;
    case 'inbox': await inbox(hub); break;
    case 'doctor': out(await doctor(hub.store.root)); break;
    default:
      console.error('lenh: spawn|run|status|wait|result|cancel|followup|resume|list|reconcile|inbox|doctor');
      process.exit(2);
  }
  process.exit(0);
} catch (e) {
  if (cmd === 'inbox') process.exit(0); // hook agy la fail-closed: loi o day khong duoc chan luot cua nguoi dung
  console.error(`loi: ${e.message}`);
  process.exit(1);
}
