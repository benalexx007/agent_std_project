import fs from 'node:fs';
import { contract } from './schema.mjs';
import { clone, hash, now, requireThat, artifactCheck, confined } from './util.mjs';
import { workKey } from './work.mjs';

// Additive namespace: old v2 databases remain readable without rewriting history.
const empty = () => ({ schema_version: 1, records: {} });
export const researchState = (state) => state.research || empty();
export const recordRef = (entry) => ({ record_id: entry.record.record_id, revision: entry.record.revision, sha256: entry.sha256 });
const ownerCheck = (state, owner, epoch) => requireThat(owner === state.owner.id && Number(epoch) === state.owner.epoch, 'Stale or invalid research owner/epoch');

export function researchEntry(state, recordId, revision) {
  requireThat(revision === undefined || (Number.isSafeInteger(revision) && revision >= 1), 'Invalid research revision');
  const history = Object.hasOwn(researchState(state).records, recordId) ? researchState(state).records[recordId] : null;
  const entry = revision ? history?.find((e) => e.record.revision === revision) : history?.at(-1);
  requireThat(entry, 'Unknown research record/revision: ' + recordId);
  requireThat(hash(JSON.stringify(entry.record)) === entry.sha256, 'Research record hash mismatch: ' + recordId);
  return entry;
}

export function researchValidity(state, entry, seen = new Set(), historicalSubject = false) {
  const r = entry.record, key = r.record_id + ':' + r.revision;
  const reasons = [];
  if (seen.has(key)) return { current: false, reasons: ['Research reference cycle'] };
  const next = new Set([...seen, key]);
  try {
    if (!historicalSubject) requireThat(researchEntry(state, r.record_id).sha256 === entry.sha256, 'Superseded research revision');
    const task = state.tasks[r.task_id];
    requireThat(task?.revision === r.task_revision && task.spec.protocol_version === r.protocol_version, 'Stale task/protocol revision');
    for (const captured of entry.task_context || []) {
      requireThat(state.tasks[captured.task_id]?.revision === captured.revision &&
        state.tasks[captured.task_id]?.spec.protocol_version === captured.protocol_version, 'Stale upstream task revision');
      captured.inputs.forEach((ref) => artifactCheck(state.project.workspace, ref));
    }
    r.artifacts.forEach((ref) => artifactCheck(state.project.workspace, ref));
    for (const ref of r.refs) {
      const dependency = researchEntry(state, ref.record_id, ref.revision);
      requireThat(dependency.sha256 === ref.sha256, 'Research reference hash mismatch');
      const checked = researchValidity(state, dependency, next, ref.relation === 'subject');
      requireThat(checked.current, 'Stale research dependency ' + ref.record_id + ': ' + checked.reasons.join('; '));
    }
    for (const runId of r.run_ids) {
      const run = state.runs[runId], attempt = state.attempts[run?.attempt_id];
      requireThat(run && attempt && attempt.task_revision === state.tasks[attempt.task_id]?.revision &&
        run.protocol_version === state.tasks[attempt.task_id].spec.protocol_version, 'Stale run reference: ' + runId);
      run.outputs.forEach((ref) => artifactCheck(state.project.workspace, ref));
      (attempt.input_refs || []).forEach((ref) => artifactCheck(state.project.workspace, ref));
    }
    for (const claimId of r.legacy_claim_ids) {
      const claim = state.claims[claimId];
      requireThat(claim?.protocol_version === r.protocol_version, 'Stale legacy claim reference');
      [...claim.supporting, ...claim.contradicting].forEach((ref) => artifactCheck(state.project.workspace, ref));
    }
  } catch (error) { reasons.push(error.message); }
  return { current: reasons.length === 0, reasons };
}

function checkMeaning(state, r) {
  const dependencies = r.refs.map((ref) => {
    const entry = researchEntry(state, ref.record_id, ref.revision);
    requireThat(entry.sha256 === ref.sha256, 'Research reference hash mismatch');
    requireThat(researchValidity(state, entry, new Set(), ref.relation === 'subject').current, 'Cannot use stale research dependency');
    return entry.record;
  });
  requireThat(!r.refs.some((ref) => ref.record_id === r.record_id), 'Self reference is not allowed');
  requireThat(new Set(r.refs.map((ref) => ref.record_id)).size === r.refs.length, 'Duplicate research reference');
  const d = r.data;
  if (r.kind === 'hypothesis') {
    requireThat(d.predictions.length || d.proof_obligations.length, 'Hypothesis needs predictions or proof obligations');
    if (d.novelty === 'candidate_within_search_scope') requireThat(d.novelty_basis?.trim(), 'Candidate novelty needs search scope/date/basis');
  }
  if (['hypothesis', 'claim'].includes(r.kind) && ['supported', 'contradicted'].includes(d.support)) {
    const outcome = d.support === 'supported' ? 'supports' : 'contradicts';
    const premises = dependencies.filter((_, index) => r.refs[index].relation !== 'subject');
    requireThat(premises.some((p) => p.kind === 'evidence' && p.data.outcome === outcome) ||
      (d.support === 'supported' && premises.some((p) => p.kind === 'derivation' && ['reviewed_proof', 'verified_proof'].includes(p.data.level))),
    'Scientific support needs an explicit matching dependency evidence/proof reference');
    const contrary = dependencies.some((p) => p.kind === 'evidence' && p.data.outcome === (outcome === 'supports' ? 'contradicts' : 'supports'));
    requireThat(!contrary || dependencies.some((p) => p.kind === 'review' && p.data.checks.length), 'Conflicting evidence needs an explicit review');
  }
  if (r.kind === 'derivation' && ['reviewed_proof', 'verified_proof'].includes(d.level)) {
    requireThat(d.open_obligations.length === 0 && r.artifacts.length > 0, 'Proof needs closed obligations and checked evidence artifact');
    requireThat(d.verification?.outcome === 'passed' && d.verification.statement_checked === d.statement && d.verification.admitted_goals === 0,
      'Proof needs a passing verification of the same statement with no admitted goals');
    requireThat(d.verification.kind === (d.level === 'verified_proof' ? 'formal' : 'review'), 'Numerical/symbolic checks cannot become a proof');
  }
  if (r.kind === 'experiment' && d.mode === 'confirmatory') requireThat(d.predictions.length > 0, 'Confirmatory experiment needs predeclared predictions');
  if (r.kind === 'evidence') {
    requireThat(r.artifacts.length || r.run_ids.length, 'Evidence needs raw artifacts or run references');
    for (const runId of r.run_ids) {
      if (state.runs[runId].status !== 'completed') requireThat(d.outcome === 'failed_run', 'Failed run cannot support or refute a scientific claim');
    }
  }
  if (r.kind === 'review') {
    requireThat(d.verdict === 'inconclusive' || (d.checks.length && (r.artifacts.length || r.refs.length)), 'Review verdict needs performed checks and evidence');
    requireThat(d.verdict !== 'supported' || d.open_obligations.length === 0, 'Open obligations cannot be reviewed as supported');
  }
}

export function recordResearch(store, input, owner, epoch, attemptId) {
  contract('research-record', input);
  return store.transaction((state) => {
    ownerCheck(state, owner, epoch);
    const r = clone(input), task = state.tasks[r.task_id];
    requireThat(task && task.revision === r.task_revision && task.spec.protocol_version === r.protocol_version, 'Research task/revision/protocol mismatch');
    if (attemptId) {
      const a = state.attempts[attemptId], unit = a && state.work_units[workKey(a.task_id, a.work_unit_id)];
      requireThat(a && a.task_id === r.task_id && a.task_revision === r.task_revision && a.owner_epoch === state.owner.epoch &&
        unit?.assignment_id === a.assignment_id && unit.generation === a.assignment_generation && !a.settled &&
        ['dispatching', 'running', 'waiting_for_result', 'yielding', 'pause_requested'].includes(a.observed_state) && a.desired_state !== 'cancelled',
      'Stale assignment cannot publish research');
    }
    state.research ||= empty();
    const history = Object.hasOwn(state.research.records, r.record_id) ? state.research.records[r.record_id] : [];
    const previous = history.at(-1)?.record;
    requireThat(r.revision === (previous?.revision || 0) + 1, 'Research revision must increase by exactly one');
    requireThat(!previous || (previous.kind === r.kind && previous.task_id === r.task_id), 'Research identity/kind is immutable');
    r.artifacts.forEach((ref) => artifactCheck(state.project.workspace, ref));
    for (const runId of r.run_ids) requireThat(Object.hasOwn(state.runs, runId), 'Unknown run reference');
    for (const claimId of r.legacy_claim_ids) requireThat(Object.hasOwn(state.claims, claimId), 'Unknown legacy claim reference');
    checkMeaning(state, r);
    if (r.kind === 'feedback') {
      const knownConfig = r.data.config_hash === state.config_hash || (state.config_history || []).some((c) => c.config_hash === r.data.config_hash);
      requireThat(knownConfig, 'Feedback must identify a known configuration version');
      requireThat(r.data.bundle_version === 'original' || Object.hasOwn(state.improvements?.changes || {}, r.data.bundle_version), 'Unknown feedback bundle version');
    }
    const taskContext = new Map();
    const capture = (tid) => {
      if (taskContext.has(tid)) return;
      const t = state.tasks[tid];
      const inputs = t.spec.inputs.map((ref) => {
        const sha256 = hash(fs.readFileSync(confined(state.project.workspace, ref.path)));
        requireThat(!ref.sha256 || ref.sha256 === sha256, 'Research input changed');
        return { path: ref.path, sha256 };
      });
      taskContext.set(tid, { task_id: tid, revision: t.revision, protocol_version: t.spec.protocol_version, inputs });
      t.spec.dependencies.forEach(capture);
    };
    capture(r.task_id);
    const entry = { record: r, sha256: hash(JSON.stringify(r)), task_context: [...taskContext.values()], recorded_at: now(), recorded_by: owner, owner_epoch: state.owner.epoch,
      attempt_id: attemptId || null, verification_trust: 'operator_or_agent_attestation_not_semantic_proof' };
    state.research.records[r.record_id] = [...history, entry];
    const validity = researchValidity(state, entry);
    requireThat(validity.current, validity.reasons.join('; '));
    return entry;
  });
}

export function researchReview(state, taskId) {
  if (taskId) requireThat(state.tasks[taskId], 'Unknown research task');
  const entries = Object.values(researchState(state).records).map((h) => researchEntry(state, h.at(-1).record.record_id));
  const selected = taskId ? entries.filter((e) => e.record.task_id === taskId) : entries;
  const records = selected.map((entry) => ({ ...clone(entry), validity: researchValidity(state, entry) }));
  return { schema_version: 1, records, passed: records.every((e) => e.validity.current),
    limitations: ['Structural/provenance checks only. Reviewer/tool receipts are attestations; content, novelty and proof validity need the appropriate independent check.'] };
}

export function researchPacket(state, task) {
  const all = Object.values(researchState(state).records).map((h) => h.at(-1));
  const selected = new Map();
  const roots = Array.isArray(task.research_record_ids) ? task.research_record_ids.map((rid) => researchEntry(state, rid)) : all.filter((e) => e.record.task_id === task.task_id);
  const visit = (entry) => {
    const key = entry.record.record_id + ':' + entry.record.revision;
    if (selected.has(key)) return;
    selected.set(key, entry);
    for (const ref of entry.record.refs) {
      const dep = researchEntry(state, ref.record_id, ref.revision);
      requireThat(dep.sha256 === ref.sha256, 'Research reference hash mismatch'); visit(dep);
    }
  };
  roots.forEach(visit);
  // Reverse expansion is limited to evidence/reviews of the selected scope, not sibling hypotheses.
  // New premises needed to understand an attachment are included, but do not seed another reverse expansion.
  const focus = new Set([...selected.values()].map((e) => e.record.record_id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of all) {
      const sameSubject = focus.has(entry.record.record_id);
      const attached = ['evidence', 'review'].includes(entry.record.kind) && entry.record.refs.some((r) => focus.has(r.record_id));
      if ((sameSubject || attached) && !selected.has(entry.record.record_id + ':' + entry.record.revision)) {
        visit(entry); focus.add(entry.record.record_id); changed = true;
      }
    }
  }
  return { schema_version: 1, records: [...selected.values()].map((entry) => ({ ...clone(entry), validity: researchValidity(state, entry) })),
    excluded_latest_records: all.filter((e) => !selected.has(e.record.record_id + ':' + e.record.revision)).length,
    history_location: '.agentic/state.sqlite#research',
    policy: 'Retain assumptions, open obligations, counterevidence and stale labels. Transport completion is not scientific verification.' };
}

export const REFERENCE_FILES = {
  hypothesis: 'skills/research-design/references/hypotheses.md',
  mathematical: 'skills/research-design/references/mathematical-reasoning.md',
  experimental: 'skills/research-design/references/experiment-design.md',
  verification: 'skills/research-evaluate/references/evidence-update.md'
};

export function researchProfile(config, task) {
  const profile = task.research_profile || config.research_profile;
  return profile ? clone(profile) : null;
}

export function researchSnapshot(state, task) {
  return researchPacket(state, task).records.map(recordRef);
}

export function checkResearchSnapshot(state, refs) {
  for (const ref of refs || []) {
    const entry = researchEntry(state, ref.record_id, ref.revision);
    requireThat(entry.sha256 === ref.sha256, 'Research snapshot hash mismatch');
    entry.record.artifacts.forEach((a) => artifactCheck(state.project.workspace, a));
    for (const captured of entry.task_context || []) captured.inputs.forEach((a) => artifactCheck(state.project.workspace, a));
    // Snapshot is a pinned historical scientific context. New evidence may supersede it; it is not erased.
  }
}

export function renderResearch(state, taskId) {
  const task = state.tasks[taskId]; requireThat(task, 'Unknown task');
  const profile = researchProfile(state.config, task.spec);
  const packet = researchPacket(state, task.spec);
  const text = ['# Research output: ' + taskId, '', 'Requested format: ' + (profile?.output.format || 'artifact'), '',
    'This is an evidence/review export for the writing agent; it is not an automatically verified scientific manuscript.', ''];
  for (const entry of packet.records) {
    text.push('## ' + entry.record.kind + ': ' + entry.record.record_id + ' r' + entry.record.revision,
      '', 'Validity: ' + (entry.validity.current ? 'current' : 'needs_review: ' + entry.validity.reasons.join('; ')), '',
      '```json', JSON.stringify(entry.record, null, 2), '```', '');
  }
  return { profile, packet, markdown: text.join('\n'), scientific_verification: 'not_automatically_verified' };
}
