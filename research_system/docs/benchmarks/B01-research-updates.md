# B01 — Hypothesis development and evidence updates

Status: proposal only; a filled run appendix and explicit human approval are required before execution.

The template below is not the concrete campaign. The prepared [B01 v2 appendix](../../benchmark-runs/b01_20261025_02/protocol.md) uses four cases/one trial each and 17 tiered stages; its explicit limits replace template suggestions for that request only. It remains pending separate confirmation.

Purpose: inspect whether an agent can maintain alternatives, design a discriminating check, incorporate contradictory evidence and avoid unsupported certainty. Use cases with known evidence so the results can be reviewed; this is not a measure of global novelty.

## Cases and inputs

Four cases, two independent trials each (eight fresh-workspace trials in a proposed first run):

1. A positive association that reverses after stratification. Give a small dataset and the question, withhold the reference interpretation. Credit a correctly scoped association; do not require one exact narrative or infer causality from the table.
2. Two mechanisms agree on the observed range but predict different values outside it. Supply executable simulators with the mechanism labels hidden; ask for the next informative permitted probe and updated explanation.
3. A promising result is contradicted by an independent measurement. Reveal the second artifact at a declared checkpoint. Grade whether the agent keeps the original evidence, checks measurement error and revises scope or remains appropriately inconclusive.
4. Evidence is insufficient to separate hypotheses. Supply only observations on which both agree; grade justified uncertainty and the proposed separating observation, not a forced winner.

Create exact inputs and reference checks before the run; pin all hashes in the appendix. Keep reference labels/solutions outside the agent workspace. Search/network is disabled for this closed-case proposal, so the task measures reasoning over supplied evidence. Reference problems can still be familiar to the model; report this limitation.

## Grading and trace review

Report separate dimensions: assumptions stated, substantive alternatives, informativeness of the chosen probe, preservation of counterevidence, validity/scope of conclusion, and provenance of updates. Use deterministic checks for calculations/files and a human reviewer for scientific interpretation. Any LLM grader is supplementary, its prompt/version is recorded, and disagreement is kept for human review. Do not collapse all dimensions into a novelty score.

Collect task outcomes, performed checks, context/input/output usage with precision/source, wall time, retries and human interventions. Inspect traces for data access errors or an incorrect grading assumption before classifying agent reasoning failures. Each trial starts from a clean workspace without previous solutions.

## Proposed limits and stopping

Suggested initial ceilings, to confirm or replace in the run appendix: eight trials; at most two attempts per trial; 20,000 reserved total tokens per trial; aggregate 160,000 tokens; USD 10 aggregate if an API with known cost accounting is selected; 10 minutes wall time per trial; no paid compute beyond the stated provider. These are budget choices, not predictions or current price estimates. Subscription quota remains distinct and may be unknown. Configure all limits consistently before asking.

Stop for user pause/cancel, exhausted aggregate budget, missing evidence, changed inputs/protocol or unavailable capability. Retry/transfer stays inside the documented attempt/token limits. A new campaign requires new confirmation, even if the previous one was approved.

## Run appendix — complete before asking

Request ID/date; full task IDs/prompts and input hashes; backend/model/interface version and settings; bundle/config hashes; exact repetitions and attempt limits; graders and reference solution versions; aggregate token/cost/compute/time limits; output/evidence location; permitted control/fallback actions; who will review. No run is approved while these choices remain unspecified.
