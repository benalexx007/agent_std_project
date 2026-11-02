# Project instructions

This is a provider-neutral research-agent harness using Node.js >=24 and standard-library SQLite.

- Keep role, skill, backend/model, execution permissions and quota pools separate.
- Default orchestration is analysis (medium). synthesis_planning (highest) is a separate scientific-advisor task: synthesize analyses, independently verify/research and return a detailed plan to the orchestrator. It does not become a second root coordinator. Use it for substantive scientific planning/replanning, not every small task or status update.
- New automation tasks default through model_policy.task_class_backends to Antigravity low=gemini-3.8-flash-high/high. Explicit backends/models and frozen task selections retain precedence; do not silently fall back to codex.low. Missing provider permissions/tier mappings block work rather than grant execution.
- Use model_policy/task_class for model and effort selection: synthesis_planning=highest, analysis=medium, automation=low. Planning must independently verify primary sources and research again, not trust analysis summaries as ground truth; record current-attempt evidence in planning_review before claiming a completed plan.
- Run npm test (or the equivalent node --test command when npm is unavailable) and node scripts/check-project.mjs for runtime changes. Tests use local deterministic worker fixtures.
- Preserve task revisions, protocol versions, raw evidence and assignment fencing during recovery.
- State/handoff v4 remains compatible; GUI attachment/config services require explicit idle upgrade-gui to v5 with a backup and a v5 writer. Never silently downgrade or bypass the SQLite guard. Extensions require isolated execution roots; helper private data stays in the control root until pinned materialization/publication.
- GUI is the root orchestrator. Project-local entries and CLI services do not verify native GUI identity, instruction loading, permissions, usage or model. Native observations are scoped attestations; hard native requirements must route to a capable managed provider or remain blocked. Do not self-confirm protected GUI changes or benchmark requests.
- Isolated completed results must pass completeAttempt/journaled publication. Control root and execution root differ; recover a pending publication before dispatch, and reconcile unknown jobs before importing native output.
- A missing heartbeat is not proof a worker or remote job stopped. Reconcile unknown side effects before retry.
- External execution is disabled in example configs. Live backend/model runs and evaluation experiments require the user's verification/authorization for that stage.
- Every benchmark run requires a separate explicit human confirmation accompanied by a detailed protocol document (scope, tasks/trials, models, grading, budget, stopping rules). Designing a benchmark or permission to implement is not permission to execute it. Use purpose=benchmark and the per-run request guard; never self-confirm. Local deterministic software regression tests are authorized implementation checks, not discovery benchmarks.
- Preserve research assumptions, open proof obligations, counterevidence and pinned historical subjects. Keep execution status, scientific support, proof verification and novelty separate.
- Project improvements use immutable overlays and explicit activation/rollback. Do not rewrite personal/global skills or silently change model, budget or permissions.
- Read docs/runtime.md for state/migration boundaries and docs/verify.md for a local review flow.
