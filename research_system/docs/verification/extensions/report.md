# Research extensions — software handoff 28/10/2026

Candidate **0.6.0 / state-handoff4**. **204/204 software tests pass, 0 skipped**; static/schema checks pass (65 JavaScript files and 4 Python helpers), recovery mock pass. [Full source/evidence hashes](../v1-evidence.json), [TAP](../software-tests.tap), [static checks](../static-checks.json).

The first full run had one historical assertion expecting schema3; its [failed TAP](first-full-run-failed.tap) is retained. It was corrected to the actual v4 contract and the final complete batch passed. No production project was migrated and no model or deliberate benchmark was invoked.

| Scope | Evidence and limit |
|---|---|
| X1 policy/lock | Role/profile opt-in, narrowed task scope, inherited extras/startup guard, model tool contract; real native scope remains pending |
| X2 provisioning/migration | Wheel/environment hashes, reuse without reinstall, failed staging leaves no active target, real SQLite writer3 rejected, v3 rescue before migration |
| X3 retrieval | Fixture HTTP200/error/version parsing, partial page/cursor, redirect rejection, 429/malformed/oversized responses; no live provider compatibility claim |
| X4 bibliography | Different DOI records with colliding keys retained, failed blocks/raw source preserved, no destructive rewrite |
| X5 calculations | Symbolic assumptions and numeric boundary; independent paired mean/variance/exact sign-flip oracles; degenerate uncertainty is partial |
| X6 figures/PDF | [Fixture figure](figure.png) and [fixture rendered PDF page](paper-page.png), text/page locators and visual inspection; not validation of arbitrary scientific layouts |
| X7 lifecycle/publication | Provider capacity, cancellation, known helper spawn/commit failure, terminal evidence before reconciliation, late-result fencing, output tamper detection and existing publication journal |
| X8 accounting/context | Bounded request envelopes, duplicate-call reuse, conservative unknown-call accounting, scoped metadata/tool responses and private/pinned artifacts |

[Preflight](preflight.json) checks the exact installed Codex binary and freshly generated protocol schemas, with **0 thread/turn/model calls**. Package environment is provisioned locally; runtime profiles and external execution remain disabled in examples. A valid real-work trace or separately authorized live protocol is still needed for native acceptance. Full operational scope, activation/rollback and limitations: [extensions.md](../../extensions.md).

The four modified project skills passed the skill-creator validator; its PyYAML dependency was installed only in a separate local validation-tools directory, outside the scientific runtime environment. The original six skill workflows and fixed model tiers remain in place.
