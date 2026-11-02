// Deterministic filesystem fixture. No model/network/benchmark.
import fs from 'node:fs';
import path from 'node:path';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const context = JSON.parse(input), task = context.task, d = context.dispatch;
for (const output of task.expected_artifacts) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ cwd: process.cwd(), control_root: context.control_root,
    control_db_in_execution: fs.existsSync(path.join(process.cwd(), '.agentic/state.sqlite')) }));
}
process.stdout.write(JSON.stringify({ task_id: task.task_id, task_revision: d.task_revision, attempt_id: d.attempt_id,
  protocol_version: d.protocol_version, status: 'completed', summary: 'Local writer fixture',
  artifacts: task.expected_artifacts.map((p) => ({ path: p })), evidence_refs: [],
  checks: [{ name: 'fixture', passed: true, details: 'No model' }], limitations: ['Fixture only'], unresolved: [],
  usage: { input_tokens: null, output_tokens: null, cached_input_tokens: null, cost_usd: null } }));
