import fs from 'node:fs';
import path from 'node:path';
import { validate } from './schema.mjs';
import { resolveTask } from './config.mjs';
import { attachGui, checkedAttachment, attachmentInState, checkGuiTaskPaths } from './gui-state.mjs';
import { proposeGuiChange, applyGuiChange } from './gui-changes.mjs';
import { dispatchGuiWork, publicOperation, assessNative, prepareNativeWork, observeNativeWork } from './gui-work.mjs';
import { inspectProject, redactInspection } from './inspection.mjs';
import { registerTask, reviseTask, reopenTask, control, requestDecision, handoff } from './engine.mjs';
import { buildContext, buildOrchestratorContext } from './context.mjs';
import { recordResearch, researchReview, renderResearch } from './research.mjs';
import { projectDomain, availableDomains } from './domains.mjs';
import { runExtension } from './extension-runner.mjs';
import { extensionDocuments } from './extensions.mjs';
import { saveCheckpoint } from './checkpoints.mjs';
import { workspacePath } from './workspaces.mjs';
import { bundleResource, proposeImprovement } from './improvements.mjs';
import { id, now, hash, requireThat, confined, fileHash, writeJSON } from './util.mjs';

export const GUI_ACTIONS = {
  project: ['status', 'detach', 'frontier', 'observe'],
  change: ['prepare', 'inspect', 'apply', 'rollback', 'overlay'],
  work: ['register', 'revise', 'reopen', 'prepare', 'dispatch', 'operation', 'operation_reconcile', 'control', 'native_assess', 'native_prepare', 'native_observe', 'checkpoint'],
  research: ['record', 'review', 'export'],
  domain: ['record', 'review', 'export'],
  evidence: ['read', 'hash'], capability: ['list', 'describe', 'execute'],
  decision: ['request', 'pending'], diagnostic: ['inspect', 'handoff']
};
export const GUI_REQUEST_SCHEMA = { type: 'object', additionalProperties: false, required: ['group', 'action'], properties: {
  group: { type: 'string', enum: Object.keys(GUI_ACTIONS) }, action: { type: 'string' }, data: { type: 'object' } } };
// Exact top-level data keys; the core still validates nested scientific/task contracts.
// First list required, second optional. Catalog discovery has no model or process cost.
export const GUI_DATA_FIELDS = {
  'project.status': [[], []], 'project.detach': [[], []], 'project.frontier': [[], ['task_ids', 'task_class']],
  'project.observe': [['key', 'kind', 'source', 'value'], ['session', 'scope', 'host_version']],
  'change.prepare': [['base_revision', 'patch'], ['overlay', 'message_ref']], 'change.inspect': [['change_id'], []],
  'change.apply': [['change_id'], []], 'change.rollback': [['revision'], ['message_ref']],
  'change.overlay': [['change_id', 'reason', 'feedback_refs', 'files', 'checks'], []],
  'work.register': [['task'], ['override']], 'work.revise': [['task'], []], 'work.reopen': [['task_id', 'review'], []],
  'work.prepare': [['task_id'], []], 'work.dispatch': [['task_id', 'key'], []], 'work.operation': [['operation_id'], []],
  'work.operation_reconcile': [['operation_id', 'launcher_terminal', 'evidence'], []],
  'work.control': [['action'], ['event_id', 'task_id', 'revision', 'message']],
  'work.native_assess': [['task_id', 'effective'], ['requirements']],
  'work.native_prepare': [['task_id', 'effective', 'mode', 'key'], ['requirements']],
  'work.native_observe': [['attempt_id', 'event_id', 'state', 'handle'], ['result', 'descendants_terminal', 'evidence', 'error']],
  'work.checkpoint': [['attempt_id', 'progress'], []],
  'research.record': [['record'], ['attempt_id']], 'research.review': [[], ['task_id']], 'research.export': [[], ['task_id']],
  'domain.record': [['record'], ['attempt_id']], 'domain.review': [[], ['task_id']], 'domain.export': [[], ['task_id']],
  'evidence.read': [['root', 'path'], ['offset_bytes', 'max_bytes']], 'evidence.hash': [['path'], []],
  'capability.list': [[], []], 'capability.describe': [['operation'], []],
  'capability.execute': [['attempt_id', 'key', 'operation', 'arguments'], []],
  'decision.request': [['decision_id', 'question', 'reason', 'options', 'recommendation', 'affected_tasks', 'task_revisions', 'grant_actions'], ['supersedes_decision_id']],
  'decision.pending': [[], []], 'diagnostic.inspect': [[], ['section', 'full']], 'diagnostic.handoff': [[], []]
};
function validateData(key, data) {
  const [required, optional] = GUI_DATA_FIELDS[key];
  validate({ type: 'object', required, properties: Object.fromEntries([...required, ...optional].map((k) => [k, {}])), additionalProperties: false }, data);
  const walk = (v, depth = 0) => {
    requireThat(depth <= 32, 'GUI payload nesting limit exceeded');
    if (!v || typeof v !== 'object') return;
    for (const [k, child] of Object.entries(v)) { requireThat(!['__proto__', 'constructor', 'prototype'].includes(k), 'Unsafe GUI payload key'); walk(child, depth + 1); }
  };
  walk(data);
  for (const field of ['task_id', 'attempt_id', 'operation_id', 'change_id', 'event_id', 'key']) if (field in data)
    requireThat(typeof data[field] === 'string' && data[field].length > 0 && data[field].length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(data[field]), 'Invalid GUI identifier: ' + field);
}
const WRITE = new Set(['project.detach', 'project.observe', 'change.prepare', 'change.apply', 'change.rollback', 'change.overlay',
  'work.register', 'work.revise', 'work.reopen', 'work.dispatch', 'work.operation_reconcile', 'work.control', 'work.native_prepare', 'work.native_observe', 'work.checkpoint', 'research.record', 'domain.record', 'capability.execute', 'decision.request']);
function readResource(s, data) {
  requireThat(data.root === 'workspace' || data.root === 'bundle', 'Read root must be workspace or bundle');
  if (data.root === 'bundle') {
    workspacePath(s.config.bundle_root, data.path);
    requireThat(/^(domains|skills|schemas|docs|integrations|examples|src|adapters|scripts)\//.test(data.path) || data.path === 'extensions/research/manifest.json', 'Bundle resource is not in a public guidance/source namespace');
  }
  const file = data.root === 'bundle' ? bundleResource(s.config, s, data.path).file :
    /^\.agentic\/gui-responses\/[a-f0-9]{64}\.json$/.test(data.path) ? confined(s.project.workspace, data.path) : workspacePath(s.project.workspace, data.path);
  const stat = fs.statSync(file), offset = data.offset_bytes ?? 0, limit = data.max_bytes ?? 4096;
  requireThat(stat.isFile() && Number.isSafeInteger(offset) && offset >= 0 && offset <= stat.size && Number.isSafeInteger(limit) && limit > 0 && limit <= 16384, 'Invalid bounded read');
  const before = fileHash(file), bytes = Buffer.alloc(Math.min(limit, stat.size - offset)), fd = fs.openSync(file, 'r');
  let count; try { count = fs.readSync(fd, bytes, 0, bytes.length, offset); } finally { fs.closeSync(fd); }
  requireThat(fileHash(file) === before, 'Resource changed during read');
  return { path: data.path, sha256: before, offset_bytes: offset, total_bytes: stat.size,
    next_offset_bytes: offset + count < stat.size ? offset + count : null, content: bytes.subarray(0, count).toString('utf8') };
}

export class GuiService {
  constructor(store) { this.store = store; }
  attach(input) { return attachGui(this.store, input); }
  async call(auth, request) {
    try { return await this.store.withWriteGuard((state) => attachmentInState(state, this.store, auth, WRITE.has(request?.group + '.' + request?.action)), () => this.dispatch(auth, request)); }
    catch (error) {
      const correlation = id('gui_error'), message = redactInspection(String(error.message)).slice(0, 3000);
      const entry = JSON.stringify({ at: now(), correlation, group: typeof request?.group === 'string' ? redactInspection(request.group).slice(0, 100) : null,
        action: typeof request?.action === 'string' ? redactInspection(request.action).slice(0, 100) : null, error: message,
        stack: redactInspection(error.stack || '').slice(0, 6000) });
      try {
        const directory = path.join(this.store.directory, 'logs'), file = path.join(directory, 'gui-errors.jsonl');
        fs.mkdirSync(directory, { recursive: true });
        if (fs.existsSync(file) && fs.statSync(file).size > 1048576) { fs.rmSync(file + '.previous', { force: true }); fs.renameSync(file, file + '.previous'); }
        fs.appendFileSync(file, entry + '\n', { mode: 0o600 });
      } catch { error.logging_unavailable = true; }
      error.message = message + ' [' + correlation + ']'; error.correlation = correlation; throw error;
    }
  }
  async dispatch(auth, request) {
    requireThat(Buffer.byteLength(JSON.stringify(request)) <= 262144, 'GUI request exceeds 256 KiB; use pinned input files');
    validate(GUI_REQUEST_SCHEMA, request);
    requireThat(GUI_ACTIONS[request.group].includes(request.action), 'Unsupported GUI action');
    const { s, a } = checkedAttachment(this.store, auth, WRITE.has(request.group + '.' + request.action));
    const d = request.data || {}, key = request.group + '.' + request.action, store = this.store;
    validateData(key, d);
    let result;
    switch (key) {
      case 'project.status': result = { project: s.project, domains: availableDomains(), revision: s.gui.revision, owner: s.owner, binding: { ...a, token_hash: undefined }, pending: Object.values(s.decisions).filter((x) => x.status === 'pending') }; break;
      case 'project.detach': result = store.transaction((next) => { checkedAttachment(store, auth, true); next.gui.attachments[a.attachment_id].detached_at = now(); return { detached: true, jobs_stopped: false }; }); break;
      case 'project.frontier': result = buildOrchestratorContext(s, d.task_class, { taskIds: d.task_ids }).packet; break;
      case 'project.observe': {
        requireThat(typeof d.key === 'string' && d.key.length > 0 && d.kind && d.source, 'Observation key/kind/source required');
        result = store.transaction((next) => {
          checkedAttachment(store, auth, true);
          const digest = hash(JSON.stringify(d)), prior = Object.hasOwn(next.gui.observations, d.key) ? next.gui.observations[d.key] : null;
          requireThat(!prior || prior.digest === digest, 'Observation key conflict');
          return next.gui.observations[d.key] ||= { digest, payload: d, attachment_id: a.attachment_id, config_hash: s.config_hash,
            at: now(), trust: 'adapter_reported_not_independently_verified' };
        }); break;
      }
      case 'change.prepare': result = proposeGuiChange(store, auth, d); break;
      case 'change.inspect': result = s.gui.changes[d.change_id] ?? null; break;
      case 'change.apply': result = applyGuiChange(store, auth, d.change_id); break;
      case 'change.overlay': result = proposeImprovement(store, d, s.owner.id, s.owner.epoch); break;
      case 'change.rollback': {
        const old = s.gui.revisions.find((r) => r.revision === d.revision); requireThat(old, 'Unknown rollback revision');
        result = proposeGuiChange(store, auth, { base_revision: s.gui.revision, restore_revision: d.revision, overlay: old.overlay, message_ref: d.message_ref }); break;
      }
      case 'work.register': requireThat(resolveTask(s.config, d.task, d.override || {}).role !== 'orchestrator', 'GUI is already the orchestrator'); checkGuiTaskPaths(s, d.task); result = registerTask(store, d.task, d.override || {}); break;
      case 'work.revise': requireThat(d.task?.role !== 'orchestrator', 'GUI is already the orchestrator'); checkGuiTaskPaths(s, d.task); result = reviseTask(store, d.task, s.owner.id, s.owner.epoch); break;
      case 'work.reopen': result = reopenTask(store, d.task_id, d.review, s.owner.id, s.owner.epoch); break;
      case 'work.prepare': { const t = Object.hasOwn(s.tasks, d.task_id) ? s.tasks[d.task_id] : null; requireThat(t, 'Unknown task'); checkGuiTaskPaths(s, t.spec); result = buildContext(s.config, t.spec, Object.values(s.decisions), t.notes || [], s).packet; break; }
      case 'work.dispatch': result = await dispatchGuiWork(store, auth, d); break;
      case 'work.operation': requireThat(s.gui.operations[d.operation_id], 'Unknown operation'); result = publicOperation(s.gui.operations[d.operation_id]); break;
      case 'work.operation_reconcile': {
        requireThat(d.launcher_terminal === true && Array.isArray(d.evidence) && d.evidence.length, 'Launcher termination attestation and evidence required');
        d.evidence.forEach((r) => { requireThat(fileHash(confined(s.project.workspace, r.path)) === r.sha256, 'Termination evidence changed'); });
        result = store.transaction((next) => {
          checkedAttachment(store, auth, true);
          const op = next.gui.operations[d.operation_id]; requireThat(op && ['submit_intent', 'running', 'unknown'].includes(op.state), 'Operation not awaiting reconciliation');
          requireThat(!Object.values(next.attempts).some((at) => at.dispatch_key.startsWith(op.dispatch_key) && !at.settled), 'Reconcile worker attempts and descendants first');
          op.state = 'stopped'; op.ended_at = now(); op.termination = { evidence: d.evidence, trust: 'local_launcher_terminal_attestation' }; return publicOperation(op);
        }); break;
      }
      case 'work.control': result = control(store, { event_id: d.event_id || id('gui_control'), action: d.action, target: d.task_id || 'project',
        ...(d.revision === undefined ? {} : { expected_revision: d.revision }), payload: { message: d.message || '' } }); break;
      case 'work.native_assess': result = assessNative(s, a, d); break;
      case 'work.native_prepare': result = await prepareNativeWork(store, auth, d); break;
      case 'work.native_observe': result = await observeNativeWork(store, auth, d); break;
      case 'work.checkpoint': requireThat(s.attempts[d.attempt_id]?.gui_provider?.attachment_id === a.attachment_id, 'Checkpoint binding mismatch'); result = saveCheckpoint(store, d.attempt_id, d.progress); break;
      case 'research.record': case 'domain.record': {
        const domain = projectDomain(s);
        requireThat(key === 'domain.record' || domain.id === 'research', 'Research action requires a Research project');
        result = domain.record(store, d.record, s.owner.id, s.owner.epoch, d.attempt_id); break;
      }
      case 'research.review': case 'domain.review': {
        const domain = projectDomain(s);
        requireThat(key === 'domain.review' || domain.id === 'research', 'Research action requires a Research project');
        result = domain.review(s, d.task_id); break;
      }
      case 'research.export': case 'domain.export': {
        const domain = projectDomain(s);
        requireThat(key === 'domain.export' || domain.id === 'research', 'Research action requires a Research project');
        result = domain.render(s, d.task_id); break;
      }
      case 'evidence.read': result = readResource(s, d); break;
      case 'evidence.hash': { const file = confined(s.project.workspace, d.path); result = { path: d.path, sha256: fileHash(file) }; break; }
      case 'capability.list': result = inspectProject({ workspace: s.project.workspace, section: 'capabilities' }); break;
      case 'capability.describe': result = extensionDocuments(s.config)?.manifest.operations[d.operation] ?? null; break;
      case 'capability.execute': requireThat(s.attempts[d.attempt_id]?.owner_epoch === a.owner_epoch && s.attempts[d.attempt_id]?.effective_config.role !== 'orchestrator', 'Helper needs current worker assignment'); result = await runExtension(store, d.attempt_id, d.key, d.operation, d.arguments); break;
      case 'decision.request': result = requestDecision(store, d); break;
      case 'decision.pending': result = Object.values(s.decisions).filter((x) => x.status === 'pending'); break;
      case 'diagnostic.inspect': result = inspectProject({ workspace: s.project.workspace, section: d.section, full: d.full }); break;
      case 'diagnostic.handoff': result = handoff(s); break;
      default: throw new Error('Unimplemented GUI action');
    }
    // Bound responses before entering model context; immutable export can be read in pages.
    const safe = redactInspection(result), serialized = JSON.stringify(safe ?? null);
    if (Buffer.byteLength(serialized) <= (key === 'project.frontier' ? 4096 : 24576)) return safe;
    const relative = '.agentic/gui-responses/' + hash(serialized) + '.json';
    const file = confined(s.project.workspace, relative, false);
    if (!fs.existsSync(file)) writeJSON(file, safe);
    return { oversized: true, path: relative, sha256: fileHash(file), bytes: fs.statSync(file).size,
      read: 'evidence.read with root=workspace and bounded byte ranges; no silent truncation' };
  }
}
