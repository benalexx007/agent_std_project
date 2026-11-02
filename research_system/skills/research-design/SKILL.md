---
name: research-design
description: Develop research hypotheses, mathematical arguments and discriminating experiments, or revise a research protocol after evidence.
---

# research-design

Version the protocol. Define question and candidate claims, what evidence would support or refute them, comparison/selection procedures, resources and stopping conditions. Use the study guidance provided in the task context. Check confounders and feasibility. Record post-result changes and mark exploratory analyses; do not silently replace success criteria. Request a human decision only for changes outside existing authority.

Load guidance for the actual uncertainty:

- [Hypotheses](references/hypotheses.md) for candidate explanations and knowledge extension.
- [Mathematical reasoning](references/mathematical-reasoning.md) for definitions, derivations, lemmas, proof obligations or counterexamples.
- [Experiment design](references/experiment-design.md) for a test that separates predictions rather than only optimizes a metric.
- [Independent planning verification](references/planning-verification.md) when synthesizing a complete plan from prior analysis. Verify primary sources and research again; return a current-attempt planning_review rather than only restating earlier reasoning.

These modes may be combined. Store a versioned research record with assumptions and unresolved work. Do not require all modes or a fixed number of hypotheses for every task.

Use the role, study guidance, acceptance criteria and effective configuration supplied with the task. Load only the artifacts needed for the current question. Return a concise result with evidence references, performed checks, limitations and unresolved items using the harness result contract when dispatched by the harness. Keep durable evidence outside chat.

For symbolic helper use, read [scientific tools](references/scientific-tools.md) when that capability is supplied. Keep a symbolic check distinct from a proof.
