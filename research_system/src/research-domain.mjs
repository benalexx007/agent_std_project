import { researchProfile, researchPacket, researchState, REFERENCE_FILES } from './research.mjs';
import { PLANNING_REQUIREMENTS } from './planning.mjs';
import { requireThat } from './util.mjs';

function validateProfile(profile) {
  if (!profile) return;
  requireThat(new Set(profile.reasoning_modes).size === profile.reasoning_modes.length, 'Duplicate reasoning mode');
  requireThat(!profile.output.venue || profile.output.format === 'paper', 'Venue is only applicable to paper output');
}

export const researchDomain = Object.freeze({
  id: 'research', contract_version: 1, enabled: true,
  config_schema: 'config', task_schema: 'task',
  required_roles: Object.freeze(['researcher', 'implementer', 'evaluator']),
  orchestrator_profile: 'domains/research/roles/orchestrator.md',
  rubric: (task) => 'domains/research/rubrics/' + task.study_type + '.md',
  extension_namespace: 'research-artifacts',
  helper_worker: 'extensions/research/worker.py',
  gui_entry: 'integrations/research-project/SKILL.md', gui_name: 'research-project',
  gui_connection_version: 1,
  index_key: 'research_index',
  packet_key: 'research', snapshot_key: 'research_refs', handoff_key: 'research',
  results_key: 'research',
  evidence_limitation: 'Verifies existence, hashes and structural links; does not judge scientific support, novelty, citations or statistical validity.',
  result_limitation: 'Task completion is a transport/check result, not a scientific verdict.',
  usage_limitation: 'A structurally accepted task is not a scientifically accepted research outcome.',
  inspect_policy_keys: Object.freeze(['research_profile']),
  accepted_feedback_kinds: Object.freeze(['feedback']),
  task_override_keys: Object.freeze(['research_profile', 'research_record_ids']),
  protected_config_keys: Object.freeze(['research_profile']),
  validateConfig(config) { validateProfile(config.research_profile); },
  validateTask(config, task) {
    validateProfile(config.research_profile);
    validateProfile(task.research_profile);
    requireThat(new Set(task.research_record_ids || []).size === (task.research_record_ids || []).length, 'Duplicate research record selection');
  },
  orchestratorFields: (config) => ({ research_profile: config.research_profile || null }),
  planning_requirements: PLANNING_REQUIREMENTS,
  profile: researchProfile, packet: researchPacket, state: researchState,
  guidance(config, task, readBundle, planning) {
    const profile = researchProfile(config, task);
    const needsReasoning = task.skills.some((name) => ['research-design', 'research-experiment', 'research-evaluate'].includes(name));
    const modes = needsReasoning ? (profile?.reasoning_modes || (task.study_type === 'theoretical' ? ['mathematical', 'verification'] : [])) : [];
    const guidance = [...new Set(modes)].map((mode) => ({ mode, path: REFERENCE_FILES[mode], instructions: readBundle(REFERENCE_FILES[mode]) }));
    if (planning) {
      const ref = 'skills/research-design/references/planning-verification.md';
      guidance.push({ mode: 'planning_verification', path: ref, instructions: readBundle(ref) });
    }
    return { profile, guidance };
  },
  workerFields(config, task, state, profile, guidance) {
    return {
      research_profile: profile,
      research_guidance: guidance,
      research: state ? researchPacket(state, task) : null,
      research_contract: 'schemas/research-record.schema.json; record-research / review-research / export-research. A stored verdict is an attestation, not a proof.'
    };
  }
});
