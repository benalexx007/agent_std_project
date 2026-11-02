import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

// A bounded NDJSON peer. Notifications never start inference or retry requests.
export class NativeRPC extends EventEmitter {
  constructor(input, output, { maxFrameBytes = 1048576, timeoutMs = 30000, maxPending = 32 } = {}) {
    super();
    Object.assign(this, { output, maxFrameBytes, timeoutMs, maxPending });
    this.pending = new Map(); this.nextId = 1; this.buffer = ''; this.decoder = new StringDecoder('utf8');
    input.on('data', (chunk) => {
      try {
        this.buffer += this.decoder.write(chunk);
        let index;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
          if (Buffer.byteLength(line) > this.maxFrameBytes) throw new Error('Native frame exceeds limit');
          if (line.trim()) this.receive(JSON.parse(line));
        }
        if (Buffer.byteLength(this.buffer) > this.maxFrameBytes) throw new Error('Native frame exceeds limit');
      } catch (error) { this.fail(error); }
    });
    input.on('error', (e) => this.fail(e));
    output.on('error', (e) => this.fail(e));
    input.on('end', () => this.fail(new Error('Native transport ended; reconcile before retry')));
  }
  receive(message) {
    if (message.method) return this.emit(Object.hasOwn(message, 'id') ? 'request' : 'notification', message);
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message || 'Native RPC error'), { rpcError: message.error }));
    else request.resolve(message.result);
  }
  send(message) {
    if (this.closed) throw new Error('Native transport is closed');
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > this.maxFrameBytes) throw new Error('Native outgoing frame exceeds limit');
    // Bound writable buffering as well as incoming frames.
    if (this.output.writableLength + Buffer.byteLength(line) > this.maxFrameBytes * 2) throw new Error('Native output backpressure limit');
    this.output.write(line);
  }
  request(method, params = {}) {
    if (this.pending.size >= this.maxPending) return Promise.reject(new Error('Too many pending native requests'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Native request timed out: ' + method + '; outcome may be unknown')); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method, params) { this.send({ method, ...(params === undefined ? {} : { params }) }); }
  respond(id, result) { this.send({ id, result }); }
  reject(id, message) { this.send({ id, error: { code: -32601, message } }); }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('fault', error);
  }
}
