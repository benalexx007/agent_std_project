// One detached operation process; no hidden planner, daemon or automatic resubmission.
import { Store } from '../src/store.mjs';
import { runTask } from '../src/runner.mjs';
import { now, requireThat } from '../src/util.mjs';
import { redactInspection } from '../src/inspection.mjs';
const [workspace, operationId, credential] = process.argv.slice(2);
const store = new Store(workspace);
try {
  const op = store.transaction((s) => {
    const op = s.gui?.operations[operationId];
    requireThat(op && op.credential === credential && op.state === 'submit_intent', 'Operation already claimed or invalid');
    requireThat(s.owner.epoch === op.owner_epoch && s.owner.id === op.owner && s.tasks[op.task_id].revision === op.task_revision, 'Stale operation owner/revision');
    op.state = 'running'; op.started_at = now(); return op;
  });
  try {
    const result = await runTask(store, op.task_id, op.owner, op.owner_epoch, op.dispatch_key);
    store.transaction((s) => { const x = s.gui.operations[operationId]; x.state = s.tasks[op.task_id].status; x.ended_at = now(); x.result_ref = result.attempt_id || result.attempt?.attempt_id || null; });
  } catch (error) {
    store.transaction((s) => { const x = s.gui.operations[operationId]; x.error = error.message;
      x.state = Object.values(s.attempts).some((a) => a.dispatch_key.startsWith(op.dispatch_key) && !a.settled) ? 'unknown' : 'failed'; x.ended_at = now(); });
    process.stderr.write(JSON.stringify({ operation_id: operationId, error: redactInspection(error.message).slice(0, 3000) }) + '\n'); process.exitCode = 1;
  }
} catch (error) {
  // A claim failure proves this launcher did not invoke runTask. Never infer that
  // a different launcher/worker is terminal from this process's exit alone.
  process.stderr.write(JSON.stringify({ operation_id: operationId, phase: 'claim', error: redactInspection(error.message).slice(0, 3000) }) + '\n'); process.exitCode = 1;
} finally { store.close(); }
