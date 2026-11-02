import { executeCodex } from '../src/codex-native.mjs';
import { Store } from '../src/store.mjs';
import { nativeToolHandler, cancelDelegatedTasks } from '../src/native-tools.mjs';

let text = '';
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > 4194304) throw new Error('Native launch packet exceeds limit');
}
const payload = JSON.parse(text), store = new Store(payload.context.packet.control_root || payload.context.packet.workspace);
const pending = new Map();
const send = (message) => { if (!process.connected) throw new Error('Harness IPC disconnected'); process.send(message); };
const wait = (key, message, timeout) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { pending.delete(key); reject(new Error('Harness response timeout: ' + key)); }, timeout);
  pending.set(key, { resolve, reject, timer }); send(message);
});
let controlHandler;
process.on('message', (message) => {
  const key = message.reply_to;
  if (key && pending.has(key)) {
    const p = pending.get(key); pending.delete(key); clearTimeout(p.timer);
    if (message.error) p.reject(new Error(message.error)); else p.resolve(message.value);
  } else controlHandler?.(message);
});
const stop = () => { cancelDelegatedTasks(store, payload.attempt.attempt_id, 'Parent runner stopped'); controlHandler?.({ action: 'cancel' }); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
process.on('disconnect', stop);
try {
  const result = await executeCodex(payload, {
    binding: (binding) => wait('binding', { kind: 'native_binding', binding }, 10000),
    controls: (handler) => { controlHandler = handler; return () => { controlHandler = null; }; },
    input: (requestId, params, timeout) => wait('input_' + requestId, { kind: 'native_input', request_id: requestId, params, timeout_ms: timeout }, timeout + 1000),
    tool: nativeToolHandler(store, payload.attempt.attempt_id),
    usage: (usage) => send({ kind: 'native_usage', usage }),
    controlAck: (eventId) => send({ kind: 'native_control', event_id: eventId, status: 'acknowledged' }),
    controlError: (eventId, error) => send({ kind: 'native_control', event_id: eventId, status: 'failed', error }),
    notice: (message) => process.stderr.write(message + '\n'),
    diagnostic: (chunk) => process.stderr.write(chunk)
  });
  process.stdout.write(JSON.stringify(result.result));
} catch (error) {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
} finally {
  process.off('disconnect', stop); process.off('SIGTERM', stop); process.off('SIGINT', stop);
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Native bridge closed')); }
  store.close(); if (process.connected) process.disconnect();
}
