import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { hash, now, requireThat, writeJSON, fileHash, confined, clone } from './util.mjs';
import { validateExtensionCall, EXTENSION_OPERATIONS, checkExtensionBinding } from './extensions.mjs';
import { assignmentCurrent } from './work.mjs';
import { executionRoot, workspacePath, currentHash } from './workspaces.mjs';
import { pinFile } from './blobs.mjs';
import { projectDomain } from './domains.mjs';

function active(s, a) {
  requireThat(a && !a.settled && assignmentCurrent(s, a) && a.owner_epoch === s.owner.epoch &&
    a.task_revision === s.tasks[a.task_id].revision && a.desired_state === 'running' &&
    s.desired_state === 'running' && s.tasks[a.task_id].desired_state === 'running' && !s.publication,
  'Extension assignment is stale or blocked');
}
export function extensionArtifacts(state, attempt) {
  return Object.values(state.extension_calls || {}).filter((c) => c.attempt_id === attempt.attempt_id && c.integratable !== false && ['completed', 'failed'].includes(c.status))
    .flatMap((c) => c.artifacts || []);
}
function reply(receipt) {
  return { call_id: receipt.call_id, operation: receipt.operation, status: receipt.status,
    result_status: receipt.result_status, error: receipt.error, result: receipt.result,
    artifacts: receipt.artifacts, receipt: receipt.receipt || null };
}
export function reconcileExtensionCall(store, callId, owner, epoch) {
  return store.transaction((s) => {
    requireThat(s.owner.id === owner && s.owner.epoch === epoch, 'Stale extension reconciliation owner');
    const c = s.extension_calls?.[callId]; requireThat(c && c.status === 'running', 'No unresolved extension call');
    const a = s.attempts[c.attempt_id], job = a.job_refs.find((j) => j.job_id === c.job_id);
    requireThat(job && ['completed', 'failed', 'cancelled', 'stopped'].includes(job.observed_state), 'Observe terminal helper job before reconciliation');
    c.status = 'failed'; c.error = 'Reconciled without a complete receipt; call envelope conservatively consumed';
    c.http_calls = c.reserved_http_calls; c.usage_precision = 'conservative_envelope'; c.closed_at = now();
    return c;
  });
}

export async function runExtension(store, attemptId, callKey, operation, args, testTransport = null) {
  requireThat(typeof callKey === 'string' && callKey.length > 0 && callKey.length <= 200, 'Extension call key required');
  const callId = 'extension_' + hash(attemptId + ':' + callKey).slice(0, 32);
  const payloadHash = hash(JSON.stringify({ operation, args }));
  let initial = store.read(), attempt = initial.attempts[attemptId];
  const prior = initial.extension_calls?.[callId];
  if (prior) {
    requireThat(prior.payload_sha256 === payloadHash, 'Extension call key reused with another payload');
    return prior.receipt ? reply(prior.receipt) : { call_id: callId, status: prior.status, error: prior.error || null };
  }
  active(initial, attempt);
  requireThat(attempt.workspace?.status === 'ready', 'Prepare the isolated extension workspace first');
  requireThat(Buffer.byteLength(JSON.stringify(args)) <= 262144, 'Extension arguments too large');
  requireThat(!testTransport || initial.config.backends[attempt.backend].kind === 'mock', 'Fixture transport requires a mock backend');
  const { binding, docs } = validateExtensionCall(initial.config, attempt, operation, args);
  const route = EXTENSION_OPERATIONS[operation], provider = route.provider || 'local';
  const root = executionRoot(initial, attempt), relative = projectDomain(initial).extension_namespace + '/' + callId;
  requireThat(currentHash(initial.project.workspace, relative + '/receipt.json') === null, 'Extension output namespace already exists');
  const folder = confined(store.directory, 'extension-work/' + callId, false);
  const publishedFolder = workspacePath(root, relative, false);
  let envelope = 0;
  store.transaction((s) => {
    const a = s.attempts[attemptId]; active(s, a); checkExtensionBinding(s.config, a);
    const calls = Object.values(s.extension_calls);
    const ours = calls.filter((c) => c.attempt_id === attemptId);
    const remaining = binding.limits.http_calls - ours.reduce((n, c) => n + (c.status === 'running' ? c.reserved_http_calls : c.http_calls), 0);
    envelope = route.network ? Math.min(4, remaining) : 0;
    requireThat(!route.network || envelope > 0, 'Extension HTTP call budget exhausted');
    requireThat(ours.length < binding.limits.max_calls, 'Extension call budget exhausted');
    requireThat(ours.reduce((n, c) => n + (c.status === 'running' ? c.reserved_http_calls : c.http_calls), 0) + envelope <= binding.limits.http_calls, 'Extension HTTP call budget exhausted');
    requireThat(!route.network || !calls.some((c) => c.provider === provider && c.status === 'running'), 'Provider capacity is occupied; observe/reconcile before retry');
    const jobId = callId + '_job';
    s.extension_calls[callId] = { call_id: callId, attempt_id: attemptId, task_revision: a.task_revision,
      owner_epoch: a.owner_epoch, assignment_generation: a.assignment_generation, operation, provider, job_id: jobId,
      payload_sha256: payloadHash, binding_sha256: binding.fingerprint, status: 'running',
      reserved_http_calls: envelope, http_calls: 0, created_at: now(), artifacts: [] };
    a.job_refs.push({ job_id: jobId, kind: 'extension', owner_attempt: attemptId, observed_state: 'running',
      pid: null, child_coverage: 'unverified' });
  });
  const controller = new AbortController();
  const poll = setInterval(() => { try { active(store.read(), store.read().attempts[attemptId]); } catch { controller.abort(); } }, 100);
  const timer = setTimeout(() => controller.abort(), binding.limits.timeout_ms);
  let httpCalls = 0, terminal = true, result, failure = null, folderOwned = false, spawnedPid = null;
  const sources = [];
  try {
    fs.mkdirSync(path.dirname(folder), { recursive: true }); fs.mkdirSync(folder); folderOwned = true;
    writeJSON(path.join(folder, 'input.json'), { operation, arguments: args });
    const save = (name, bytes) => fs.writeFileSync(path.join(folder, name), bytes, { flag: 'wx' });
    const fetchBounded = async (address, accept = 'application/json') => {
      let url = new URL(address);
      const allowed = ['export.arxiv.org', 'arxiv.org', 'api.openalex.org', 'api.crossref.org', 'doi.org', 'data.crossref.org', 'data.datacite.org'];
      for (let redirect = 0; redirect <= 3; redirect++) {
        requireThat(url.protocol === 'https:' && allowed.includes(url.hostname) && !url.username && !url.password, 'Unapproved retrieval origin');
        requireThat(httpCalls < envelope, 'HTTP envelope exhausted');
        active(store.read(), store.read().attempts[attemptId]);
        if (provider === 'arxiv') {
          const latest = Math.max(0, ...Object.values(store.read().extension_calls).filter((c) => c.provider === provider).map((c) => Date.parse(c.last_request_at || 0) || 0));
          const delay = Math.max(0, latest + 3100 - Date.now());
          if (delay) await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, delay); controller.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Retrieval cancelled')); }, { once: true });
          });
        }
        const fetcher = testTransport || fetch;
        let responsePromise;
        store.transaction((s) => {
          active(s, s.attempts[attemptId]); s.extension_calls[callId].last_request_at = now();
          httpCalls++;
          responsePromise = Promise.resolve(fetcher(url, { headers: { Accept: accept, 'User-Agent': 'agentic-research-harness/0.6.0' }, redirect: 'manual', signal: controller.signal }));
          responsePromise.catch(() => {});
        });
        const response = await responsePromise;
        const chunks = []; let bytes = 0;
        if (response.body) for await (const chunk of response.body) {
          bytes += chunk.length; requireThat(bytes <= binding.limits.max_bytes, 'Response byte bound exceeded'); chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks), file = 'raw-' + httpCalls + '.bin'; save(file, raw);
        const source = { url: url.href, retrieved_at: now(), status: response.status,
          content_type: response.headers.get('content-type'), path: file, sha256: hash(raw), bytes };
        sources.push(source);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location'); requireThat(location, 'Redirect without Location');
          url = new URL(location, url); continue;
        }
        requireThat(response.ok, 'Provider HTTP failure: ' + response.status);
        return { raw, source, response };
      }
      throw new Error('Redirect limit exceeded');
    };
    const runPython = async (action, arguments_) => {
      const request = path.join(folder, 'request.json'); writeJSON(request, { action, arguments: arguments_ });
      const workerPath = projectDomain(initial).helper_worker;
      const script = confined(initial.config.bundle_root, workerPath);
      requireThat(Object.hasOwn(docs.lock.files, workerPath), 'Unpinned helper entrypoint');
      const env = { SystemRoot: process.env.SystemRoot || '', WINDIR: process.env.WINDIR || process.env.SystemRoot || '', TEMP: folder, TMP: folder,
        MPLCONFIGDIR: path.join(folder, 'matplotlib-cache'), PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };
      const python = docs.environment.python;
      await supervised(python, ['-I', '-B', '-X', 'pycache_prefix=' + path.join(folder, 'bytecode-cache'), script, request, folder], env);
      const file = path.join(folder, 'result.json'); requireThat(fs.statSync(file).size <= binding.limits.max_bytes, 'Helper result too large');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const supervised = (command, argv, env) => new Promise((resolve, reject) => {
      let child, commitError = null, stderr = '', outputBytes = 0, overflow = false;
      const stop = () => child?.kill('SIGKILL');
      const consume = (chunk, err = false) => {
        outputBytes += chunk.length;
        if (err && stderr.length < 4096) stderr += chunk.toString().slice(0, 4096 - stderr.length);
        if (outputBytes > 65536) { overflow = true; child.kill(); }
      };
      try { store.transaction((s) => {
        active(s, s.attempts[attemptId]);
        child = spawn(command, argv, { cwd: folder, shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
        terminal = false; spawnedPid = child.pid || null;
        const j = s.attempts[attemptId].job_refs.find((j) => j.job_id === callId + '_job'); j.pid = spawnedPid;
        child.stdout.on('data', (c) => consume(c)); child.stderr.on('data', (c) => consume(c, true));
        controller.signal.addEventListener('abort', stop, { once: true }); child.once('error', () => {});
        child.once('close', (code) => {
          terminal = true; controller.signal.removeEventListener('abort', stop);
          if (code === 0 && !overflow && !controller.signal.aborted && !commitError) resolve();
          else reject(new Error('Helper failed or stopped: ' + (commitError || stderr || code)));
        });
      }); } catch (error) {
        commitError = error.message;
        if (child) stop(); else { terminal = true; reject(error); }
      }
      if (controller.signal.aborted) stop();
    });
    const snapshot = (relativePath) => {
      const source = workspacePath(root, relativePath);
      const input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const target = path.join(folder, 'source-input');
      try {
        const actual = fs.fstatSync(input), expected = fs.statSync(workspacePath(root, relativePath));
        requireThat(actual.isFile() && actual.ino === expected.ino && actual.dev === expected.dev && actual.size <= binding.limits.max_bytes, 'Helper input changed or exceeds bounds');
        const output = fs.openSync(target, 'wx'), buffer = Buffer.alloc(65536); let bytes = 0;
        try { let n; while ((n = fs.readSync(input, buffer, 0, buffer.length, null))) {
          bytes += n; requireThat(bytes <= binding.limits.max_bytes, 'Helper input grew past its bound');
          let written = 0; while (written < n) written += fs.writeSync(output, buffer, written, n - written);
        } } finally { fs.closeSync(output); }
        requireThat(bytes === actual.size, 'Helper input changed while snapshotting');
      } finally { fs.closeSync(input); }
      sources.push({ path: relativePath, sha256: fileHash(target), origin: 'workspace_snapshot' }); return target;
    };
    if (operation === 'scholarly.arxiv') {
      const url = new URL('https://export.arxiv.org/api/query');
      url.searchParams.set(args.id ? 'id_list' : 'search_query', args.id || args.query);
      url.searchParams.set('start', String(args.start || 0)); url.searchParams.set('max_results', String(Math.min(args.limit || 10, binding.limits.max_records)));
      const { source } = await fetchBounded(url, 'application/atom+xml');
      result = await runPython('arxiv', { path: path.join(folder, source.path) });
      const payload = result.data;
      if (payload) { result.coverage = payload.returned + (args.start || 0) >= payload.total_results ? 'complete_for_query' : 'partial';
        result.next_start = result.coverage === 'partial' ? (args.start || 0) + payload.returned : null; }
    } else if (operation === 'scholarly.openalex' || operation === 'scholarly.crossref') {
      const alex = operation.endsWith('openalex');
      const url = new URL(alex ? 'https://api.openalex.org/works' : 'https://api.crossref.org/works');
      url.searchParams.set(alex ? 'search' : 'query', args.query);
      url.searchParams.set(alex ? 'per-page' : 'rows', String(Math.min(args.limit || 10, binding.limits.max_records)));
      if (args.cursor) url.searchParams.set('cursor', args.cursor);
      const { raw } = await fetchBounded(url);
      const data = JSON.parse(raw.toString('utf8'));
      requireThat(!data.error && !data.errors, 'Provider returned an error payload');
      const rows = alex ? data.results : data.message?.items;
      requireThat(Array.isArray(rows), 'Malformed provider result shape');
      requireThat(rows.length <= Math.min(args.limit || 10, binding.limits.max_records), 'Provider exceeded the declared record bound');
      result = { status: 'completed', records: rows, coverage: 'bounded_page',
        total_results: alex ? data.meta?.count ?? null : data.message?.['total-results'] ?? null,
        continuation: alex ? data.meta?.next_cursor || null : data.message?.['next-cursor'] || null,
        keyless_paging: alex ? 'Not exhaustive; deeper cursor paging may require an authorized account key.' : null };
      if (alex) {
        const parsed = await runPython('openalex', { path: path.join(folder, sources.at(-1).path) });
        result.abstracts = parsed.data; result.parser_status = parsed.status;
        // Persist the enriched metadata, not the parser-only intermediate.
        writeJSON(path.join(folder, 'result.json'), result);
      }
    } else if (operation === 'bibliography.doi') {
      const { source } = await fetchBounded('https://doi.org/' + encodeURI(args.doi), 'application/x-bibtex');
      result = await runPython('bibliography', { path: path.join(folder, source.path) });
      requireThat(result.entries?.length === 1 && result.entries[0].doi === args.doi.toLowerCase(), 'DOI content negotiation identity mismatch or missing DOI');
    } else if (operation === 'scholarly.download') {
      requireThat(Object.values(store.read().extension_calls).filter((c) => c.attempt_id === attemptId && c.operation === operation).length <= binding.limits.max_papers, 'Paper download budget exhausted');
      const id = args.id; requireThat(/^(?:[0-9]{4}\.[0-9]{4,5}|[a-z-]+\/[0-9]{7})v[0-9]+$/i.test(id), 'Download requires a versioned arXiv identifier');
      const { raw, source } = await fetchBounded('https://arxiv.org/' + (args.format === 'html' ? 'html/' : 'pdf/') + id,
        args.format === 'html' ? 'text/html' : 'application/pdf');
      requireThat(args.format === 'html' ? /html/i.test(source.content_type || '') : raw.subarray(0, 5).toString() === '%PDF-', 'Unexpected full-text content type');
      result = { status: 'completed', id, format: args.format, coverage: 'versioned_full_text', source };
    } else if (operation === 'paper.render') {
      const renderer = docs.environment.poppler; requireThat(renderer, 'PDF renderer is not provisioned');
      for (const [p, digest] of Object.entries(renderer.files)) requireThat(fileHash(p) === digest, 'PDF renderer binding changed');
      const input = snapshot(args.path), page = String(args.page), target = path.join(folder, 'page');
      await supervised(renderer.command, ['-f', page, '-l', page, '-singlefile', '-scale-to', '1600', '-png', input, target],
        { SystemRoot: process.env.SystemRoot || '', TEMP: folder, TMP: folder });
      result = { status: 'completed', page: args.page, files: ['page.png'], coverage: 'one_rendered_page', interpretation_verified: false };
    } else {
      const data = clone(args);
      if (data.path) data.path = snapshot(data.path);
      result = await runPython(route.action, data);
    }
    active(store.read(), store.read().attempts[attemptId]);
    if (!fs.existsSync(path.join(folder, 'result.json'))) writeJSON(path.join(folder, 'result.json'), result);
  } catch (error) { failure = error.message; controller.abort(); }
  finally { clearInterval(poll); clearTimeout(timer); }
  const artifacts = [];
  if (folderOwned) for (const e of fs.readdirSync(folder, { withFileTypes: true })) if (e.isFile() && !['request.json'].includes(e.name)) {
    const p = path.join(folder, e.name);
    const blob = await pinFile(initial.project.workspace, p, undefined, binding.limits.max_bytes);
    artifacts.push({ path: relative + '/' + e.name, sha256: blob.sha256, blob: blob.path, bytes: blob.bytes });
  }
  const receipt = { call_id: callId, operation, status: failure ? 'failed' : 'completed', result_status: result?.status || null,
    error: failure, observation: 'trusted_finite_helper', binding_sha256: binding.fingerprint,
    payload_sha256: payloadHash, http_calls: httpCalls, usage_precision: 'observed_requests', external_cost_usd: null,
    sources, artifacts: artifacts.map(({ path, sha256 }) => ({ path, sha256 })), completed_at: now(),
    result: result && Buffer.byteLength(JSON.stringify(result)) <= 4096 ? result : { preview: 'Read result.json using bounded harness_read', status: result?.status } };
  const receiptPath = relative + '/receipt.json';
  if (folderOwned) { writeJSON(path.join(folder, 'receipt.json'), receipt);
    const blob = await pinFile(initial.project.workspace, path.join(folder, 'receipt.json'));
    artifacts.push({ path: receiptPath, sha256: blob.sha256, blob: blob.path, bytes: blob.bytes }); }
  let materialized = false;
  if (folderOwned) try {
    active(store.read(), store.read().attempts[attemptId]);
    fs.mkdirSync(path.dirname(publishedFolder), { recursive: true }); fs.mkdirSync(publishedFolder);
    for (const ref of artifacts) {
      const destination = workspacePath(root, ref.path, false);
      fs.copyFileSync(path.join(folder, path.basename(ref.path)), destination, fs.constants.COPYFILE_EXCL);
      requireThat(fileHash(destination) === ref.sha256, 'Helper materialization changed');
    }
    materialized = true;
  } catch (error) { failure ||= error.message; receipt.status = 'failed'; receipt.error = failure; }
  return store.transaction((s) => {
    const c = s.extension_calls[callId], a = s.attempts[attemptId];
    let valid = true; try { active(s, a); } catch { valid = false; }
    c.integratable = valid && terminal && materialized;
    c.status = terminal ? (failure || !valid ? 'failed' : 'completed') : 'running';
    if (!valid) { receipt.status = 'failed'; receipt.error = 'Late result retained without integration'; }
    Object.assign(c, { receipt, artifacts, http_calls: httpCalls, usage_precision: 'observed_requests', error: failure, closed_at: terminal ? now() : null });
    const j = a.job_refs.find((j) => j.job_id === c.job_id);
    j.pid ||= spawnedPid;
    j.observed_state = terminal ? (failure ? 'failed' : 'completed') : 'unknown';
    j.child_coverage = terminal ? 'verified_no_children' : 'unverified';
    receipt.receipt = artifacts.find((r) => r.path === receiptPath) ? { path: receiptPath, sha256: artifacts.find((r) => r.path === receiptPath).sha256 } : null;
    return reply(receipt);
  });
}
