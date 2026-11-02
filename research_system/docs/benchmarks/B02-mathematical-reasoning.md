# B02 — Mathematical development and proof calibration

Status: proposal only, not executed. Ask the human with a completed run appendix before each run.

Purpose: test development and verification of mathematical arguments, particularly assumptions, missing obligations and counterexamples. Separate finding a statement from verifying one supplied in the prompt, following the distinction discussed in [Discover and Prove](https://aclanthology.org/2026.acl-long.3/). This does not establish open-ended theorem discovery.

## Cases

Four cases, two independent trials each in the suggested first campaign:

1. Derive the minimizer and conditions for a small quadratic objective. Provide a parameterized objective, withhold the formula and ask the agent to classify positive-definite, singular and indefinite regimes. The reference solution and exact arithmetic checks are prepared separately.
2. Review a purported derivation that divides by an expression that may be zero. Require an actual domain split or counterexample, not only a generic warning.
3. Given finite observations of a sequence, develop a conjecture and a check that could refute it. Prepare a counterexample beyond the observed range. Grade the distinction between observed regularity and a proved general statement.
4. An optimization bound has a hidden assumption mismatch. Give definitions and the derivation; ask for the smallest corrected statement or a counterexample. Do not require one particular proof route.

The exact problem instances, acceptable mathematical answers, tolerances and reference verifier are frozen in the appendix before execution. Variants used to tune skills are marked development cases, not held-out cases. Store mathematical statements and verifier inputs outside any LLM judge's summary-only context.

## Evaluation

Grade statement discovery, validity of derivation, assumptions/domain, treatment of boundary cases, counterexample correctness, unresolved obligations and evidence-level calibration separately. Numerical tests receive credit within their scope and never count as a general proof. A human checks semantic correspondence between the intended statement and any formalization. If a proof assistant is used, record tool/library versions, verifier output and any admitted goals; otherwise do not claim formal verification.

Use exact/symbolic checks where the reference verifier supports them; keep tool failures separate from mathematical failure. Reviewers may mark inconclusive. Score evidence about these cases only, without a global “mathematical research capability” certificate.

## Limits and run appendix

Suggested scope: eight trials, at most two attempts per trial, 25,000 reserved tokens per trial, aggregate 200,000 tokens, USD 12 API ceiling when accounting is known, 15 minutes per trial, no training or external GPU jobs. Confirm or replace these ceilings with the chosen provider and actual tool availability; they are not cost predictions. Stop on missing verifier/inputs, exhausted limits or human control. Do not silently substitute numerical testing for a promised formal check.

Before asking, add request/task IDs, complete prompts/input/reference hashes, exact backend/model/settings, bundle/config fingerprints, tools/versions, repetition/grading protocol, aggregate budgets, output location and fallback/stop rules. Hash that completed workspace document and bind the per-run approval to it. No execution is authorized by this template.

Allocate task classes separately from roles: analysis/medium for derivation and proof review; synthesis_planning/highest for a final research plan, with fresh independent primary-source/calculation checks and planning_review. Preserve assumptions and unresolved obligations. Use automation/low only for agent-directed established procedures; exact verifier scripts run without an extra LLM. Specify actual per-stage model/effort and recompute aggregate reservations/call counts before approval; the suggested trial caps above are not a preapproved multi-stage budget. Pin any execution manifest with its hash.
