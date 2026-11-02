# Benchmark proposals and per-run approval

Status: designed, not executed. No benchmark is needed to accept the v1 core.

The user authorizes choosing/designing benchmarks but requires a question with a detailed document before every execution. The protocols below are templates for that question. They are not approvals, results or scheduled jobs.

| Proposal | Measures | Does not establish |
|---|---|---|
| [B01: research updates](B01-research-updates.md) | Hypothesis development, counterevidence and calibrated conclusions on verifiable cases | Open-ended scientific novelty |
| [B02: mathematical reasoning](B02-mathematical-reasoning.md) | Derivations, assumptions, counterexamples and appropriate proof labels | General theorem discovery or correctness outside the task scope |
| [B03: experimental design](B03-experimental-design.md) | Choosing informative experiments and interpreting known mechanisms | A universally superior research policy |

Before asking, copy the chosen protocol into the project's workspace and complete its run appendix: request ID, task IDs/prompts, exact model/backend/interface, source/data versions, trials, graders, total budget and cancellation rules. Include the complete appendix in the document being hashed. Show the human the document link, concise purpose, scope, limits and requested action. Do not execute until the reply explicitly approves that request.

Register fresh tasks with purpose=benchmark and benchmark_request_id. Create a request file matching schemas/benchmark-request.schema.json, referencing the workspace protocol path/hash and exact task IDs. request-benchmark snapshots task specs/config/active bundle. Record the actual human reply with confirm-benchmark only after it arrives. A trusted local operator can write state directly; this workflow enforces consistency, not independent human authentication.

    node scripts/harness.mjs request-benchmark --config CONFIG --file REQUEST --owner OWNER --epoch EPOCH
    node scripts/harness.mjs confirm-benchmark --config CONFIG --request REQUEST_ID --file CONFIRMATION --owner OWNER --epoch EPOCH

CONFIRMATION contains decision (approve or decline), protocol_sha256 and confirmation_text (the human's reply). Do not generate approval text on the human's behalf. A bounded request may include the precisely documented trials; a repeat campaign, changed protocol/model/task/config/bundle or larger budget needs a new request and another question. Completed requests cannot be reused. Admission accounts for attempts, reserved/settled tokens and cost; it is not a physical provider-side hard cap.

Normal implementation regression tests use deterministic fixtures without models or benchmark datasets. They may test this permission state machine with synthetic approvals and no benchmark execution. Such tests are labelled local software verification and are never reported as benchmark results.

## Model policy and prepared B01

Every completed appendix assigns task_class, tier, model and reasoning_effort per stage. Use synthesis_planning/highest for independently verified final planning, analysis/medium for substantive work and automation/low only when an agent is needed for a predefined procedure. Deterministic driver code needs no LLM. Planning rechecks raw primary sources and researches uncertainties afresh; record planning_review for that attempt, not a copied analysis verdict. Other backend mappings remain unset until configured and verified.

The concrete [B01 v2 protocol](../../benchmark-runs/b01_20261025_02/protocol.md) is prepared pending separate approval: four closed cases, 17 serial calls (4 Astra High + 13 Sol High), 380,000 reservation tokens, 65 minutes, no retries/fallback. Sol Medium and external literature research are not measured in this campaign. The earlier b01_20261025_01 remains preserved as superseded with zero attempts; approvals are not inherited.

B01 preparation creates a new workspace/request ID and pins execution_manifest in the permission request. The manifest freezes ordered stages, models, inputs, source and executable hashes. Confirmation/admission/final dispatch check the manifest, and the driver rechecks pinned files and journals derived hashes before each stage. Pending request replacement uses supersede-benchmark with a file containing request_id, workspace and reason; it grants no permission. Run preparation only after source edits are complete. The runner is single-use; a partial campaign requires review and a fresh request before another execution.

## Source change after operational review

The stored b01_20261025_02 campaign is now historical: source changes in v0.3.1 and the move into research_system invalidate its prepared paths/fingerprints. Keep its protocol/manifest unchanged; pending status is not run-readiness. No new campaign has been prepared or approved in this patch.

B01 driver now selects handoffs by stage (analysis for planner, plan for calculator, plan/calculations for updater, full case sequence for evaluator); individual records are not truncated and all outputs remain archived. This reduces unnecessary copying without claiming bounded context for every future research graph. A future actual campaign must regenerate the exact protocol/manifests and seek its own approval.
