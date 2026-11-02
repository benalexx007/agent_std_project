# B03 — Experimental design and empirical falsification

Status: designed, not executed. A completed per-run protocol and explicit human confirmation are required.

Purpose: test whether the agent chooses experiments that distinguish explanations, implements the intended measurement and changes its conclusion appropriately. Use known synthetic mechanisms for reviewable answers; the benchmark does not test whether real scientific novelty has been achieved.

## Task design

Prepare three environments, each with two independent agent trials (six trials):

1. A system appears to improve with a treatment, but a confounder explains the effect. The agent can request a small number of controlled interventions. The reference mechanism and permitted interventions are fixed before running.
2. Two algorithms look equivalent under average-case observations but differ near a parameter boundary. The agent must propose a comparison, derive or state its expected outcome, execute the permitted probes and characterize the regime in which a claim holds.
3. A simulator contains a measurement bug producing a striking “discovery”. The agent receives the code and raw outputs, can design sanity checks, and should investigate whether the anomaly is a mechanism or an implementation artifact. Alternative valid diagnoses receive credit.

Freeze simulator/data/code hashes, task prompts, allowed tool surface and reference checks in the run appendix. Keep reference mechanism labels and grader code outside the agent's writable workspace. Do not assert causal correctness beyond the known synthetic environment. Exploratory observations and later confirmatory tests must be distinguished by timestamp/revision.

## Evaluation

Record each proposed experiment's question, manipulated variable, controls, predictions, measurement and stopping rule. Grade informativeness, implementation fidelity, interpretation, handling of negative/failed runs, reproducibility and scope of conclusion. Do not reward a larger number of experiments or agent processes by itself. Compare selected probes with a prepared oracle when appropriate; use human review for valid alternatives and an inconclusive option.

Collect actual tool/model usage and source/precision, elapsed time, failed/repeated work, recovery and human intervention. A correct conclusion without a defensible evidence chain is reported separately from a fully supported result. Unavailable tools and environment errors are diagnosed separately.

## Limits and approval

Suggested first scope: six trials, at most two attempts and six simulator probes per trial; 30,000 reserved tokens per trial; 180,000 aggregate tokens; USD 12 API ceiling if accounting is known; 15 minutes wall time per trial. No network search, model training or remote compute. These ceilings are proposals and must be configured and confirmed, not treated as prices or guaranteed usage.

The completed appendix must name request/task IDs, exact prompts/inputs, tool versions, backend/model/settings, bundle/config fingerprints, reference checks/graders, trials, token/cost/compute/time caps, evidence destination and permitted recovery/control. Pause/cancel or budget exhaustion stops the campaign. Changes or a repeat campaign require another question and request. The current document authorizes no execution.

Separate preliminary analysis (medium) from final synthesis_planning (highest). The planner must independently inspect raw observations/code and research the discriminating question again, recording a current-attempt planning_review before the chosen experiment is released. Use analysis for interpretation/implementation and automation only for established agent procedures; deterministic simulators/drivers need no extra LLM. Freeze task_class/tier/model/effort per stage, execution manifest/hash and revised aggregate budgets in the completed appendix. Do not inherit Codex mappings for an unconfigured provider.
