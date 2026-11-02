// Deterministic fixture, not a model or a scientific experiment.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const { task, attempt } = JSON.parse(input);
  const options = task.mock || {};
  let yielding = false;
  const timers = [];
  const checkpoint = () => {
    if (process.connected) process.send({ kind: 'checkpoint', progress: {
      summary: 'Synthetic work-unit checkpoint', remaining_actions: ['Finish the current synthetic unit'],
      artifacts: [], checks: [], uncertainties: ['Not a scientific evaluation']
    } });
  };
  const timer = setTimeout(() => {
    if (options.failure_code) {
      for (const pending of timers) clearTimeout(pending);
      if (process.connected) process.send({ kind: 'failure', evidence: { code: options.failure_code, message: 'Injected fixture failure' } }, () => {
        process.disconnect(); process.exitCode = 8;
      });
      else process.exitCode = 8;
      return;
    }
    if (options.fail) process.exit(7);
    if (!options.missing_output) {
      if (options.malformed) process.stdout.write('{broken');
      else process.stdout.write(JSON.stringify({
        task_id: task.task_id, task_revision: task.task_revision, attempt_id: attempt.attempt_id,
        protocol_version: task.protocol_version, status: 'completed', summary: 'Deterministic harness fixture completed.',
        artifacts: [], evidence_refs: [], checks: [{ name: 'fixture', passed: !options.failed_check, details: 'Checks the harness transport only.' }],
        limitations: ['Synthetic fixture; no research conclusion or agent-quality measurement.'], unresolved: [],
        usage: { input_tokens: options.input_tokens ?? 20, output_tokens: options.output_tokens ?? 10, cached_input_tokens: 0, cost_usd: 0 }
      }));
    }
    if (process.connected) process.disconnect();
  }, options.duration_ms ?? 30);
  timers.push(timer);
  if (options.checkpoint_after_ms !== undefined) timers.push(setTimeout(checkpoint, options.checkpoint_after_ms));
  if (options.yield_after_ms !== undefined) timers.push(setTimeout(() => {
    if (process.connected) process.send({ kind: 'yield_request' });
  }, options.yield_after_ms));
  if (options.progress_tokens !== undefined) timers.push(setTimeout(() => {
    if (process.connected) process.send({ kind: 'telemetry', update: {
      event_id: 'fixture_progress', sequence: 1, scope: 'attempt', mode: 'cumulative', includes_children: true,
      input_tokens: options.progress_tokens, output_tokens: 0, cost_usd: 0, context_headroom_tokens: null
    } });
  }, Math.min(20, options.duration_ms ?? 30)));
  process.on('message', (message) => {
    if (message.action === 'steer' && process.connected) process.send({ event_id: message.event_id, applied: true });
    if (message.action === 'yield') { yielding = true; for (const pending of timers) clearTimeout(pending); checkpoint(); }
    if (message.action === 'checkpoint_saved' && yielding) {
      process.disconnect();
      process.exitCode = 0;
    }
  });
  process.once('SIGTERM', () => { for (const pending of timers) clearTimeout(pending); process.exit(0); });
});
