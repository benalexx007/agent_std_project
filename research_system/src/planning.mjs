import { contract } from './schema.mjs';
import { artifactCheck, requireThat } from './util.mjs';
import { executionRoot } from './workspaces.mjs';

export const isPlanning = (task) => (task.model_selection?.task_class || task.task_class) === 'synthesis_planning';
export const PLANNING_REQUIREMENTS = {
  independent_research: true, primary_source_checks: true, attempt_scoped_evidence: true,
  instructions: 'Act as the scientific advisor to the research team, separately from its analysis-tier orchestrator. Treat analyses as unverified input. Independently inspect primary sources/code/data, research important or uncertain points again within authorized resources, resolve or retain disagreements, and produce a planning_review with actual evidence. Return a detailed plan to the orchestrator with rationale, assumptions, steps, responsible roles, dependencies, outputs, acceptance checks, resources, stopping conditions and unresolved decisions. Do not take over coordination or dispatch workers. Do not merely restate or reword analysis. Local repository/data/calculation research is appropriate for internal questions; use fresh authoritative external research when needed and permitted. Missing evidence leaves the plan needs_review, not completed.'
};

export function validatePlanningReview(state, attempt, result) {
  const spec = state.tasks[attempt.task_id].spec;
  const root = executionRoot(state, attempt);
  const planning = attempt.effective_config.model_selection?.task_class === 'synthesis_planning' || isPlanning(spec);
  if (!planning || result.status !== 'completed') return [];
  const review = contract('planning-review', result.planning_review);
  requireThat(review.verified_for_attempt_id === attempt.attempt_id, 'Planning verification belongs to a different attempt');
  requireThat(review.status === 'ready' && review.blocking_questions.length === 0, 'Planning still needs independent research/verification');
  const declaredAnalysis = new Set(spec.analysis_input_paths || []);
  const analysis = [...review.analysis_refs, ...(attempt.input_refs || []).filter((r) => declaredAnalysis.has(r.path))];
  analysis.forEach((r) => artifactCheck(root, r));
  for (const path of declaredAnalysis) requireThat(review.analysis_refs.some((r) => r.path === path), 'Planning review omitted a declared analysis input');
  const verifySource = (ref) => {
    artifactCheck(root, ref);
    requireThat(!analysis.some((a) => a.path === ref.path || a.sha256 === ref.sha256), 'Analysis summary cannot serve as independently verified primary evidence');
  };
  const verifyFresh = (checkedAt) => {
    const time = Date.parse(checkedAt), start = Date.parse(attempt.timestamps.created_at);
    requireThat(Number.isFinite(time) && (time >= start || !/\.\d+/.test(checkedAt) && time + 1000 > start) && time <= Date.now() + 1000, 'Planning checks must be newly recorded for this attempt');
  };
  for (const check of review.primary_checks) { verifyFresh(check.checked_at); verifySource(check.source); }
  for (const check of review.research_checks) { verifyFresh(check.checked_at); check.sources.forEach(verifySource); }
  return [...analysis, ...review.primary_checks.map((c) => c.source), ...review.research_checks.flatMap((c) => c.sources)];
  // This is a provenance/attestation gate. Whether a source actually supports an argument still needs content review.
}
