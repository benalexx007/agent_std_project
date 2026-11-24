# Agentic Research Harness

A provider-neutral harness that lets a human and several AI agents carry out research projects in a controlled, auditable way: forming hypotheses, deriving mathematics, designing experiments, collecting evidence and writing papers, proofs or reports.

The harness is a coordination and bookkeeping layer. It does not decide what is scientifically true. It keeps execution status, evidence, proof verification and novelty claims separate, preserves counter-evidence, and makes agent work resumable and reviewable.

## Design principles

- **Roles, skills, backends/models, permissions and quotas are independent axes.** A role (researcher, implementer, evaluator) never implies a backend or a permission.
- **Evidence over completion.** A finished task or exit code 0 does not confirm a claim. Claims are `supported`, `contradicted` or `inconclusive`, and a main claim needs an evaluator with an independent context.
- **Immutable history.** Task revisions, protocol versions, raw evidence and assignment generations are preserved. Recovery reconciles unknown side effects before any retry.
- **Isolated execution.** Worker output passes through a journaled publication step; control root and execution root differ; one writer per workspace.
- **Human gates.** Protected configuration changes and every benchmark run need an explicit human confirmation. The harness never self-approves.
- **No hidden spend.** External execution is disabled in example configs; live backend runs need authorization for that stage.

## Repository layout

| Path | Purpose |
|---|---|
| `research_system/` | The harness runtime (Node.js ≥ 24, standard-library SQLite), the Research domain, CLI, schemas, skills, extensions and tests. Start at [research_system/README.md](research_system/README.md) and [docs/user-guide.md](research_system/docs/user-guide.md) (documentation is currently mostly in Vietnamese). |

## Quick start

```powershell
cd research_system
npm test
node scripts/check-project.mjs
node scripts/harness.mjs inspect-project --config examples/research.json
```

Tests use deterministic local worker fixtures and make no model or network calls. Tests that need the pinned Python extension environment are skipped unless a matching environment has been provisioned locally (`npm run extensions:provision`, then `npm run extensions:lock`); that environment is machine-specific and is not committed.

## Status

- The runtime, Research workflow, model routing and planning audit are implemented and covered by local software tests.
- A domain registry and a Research façade exist so a second domain can share the harness. The Application domain is declared but **disabled**.
- Real backend/model runs are not yet live-verified, and research quality and token savings have not been measured. Passing mock tests does not establish either.

## Roadmap

1. **Research domain hardening** — recovery of settled failures, transport/usage edge cases, scoped command-worker workspaces, extension environment portability.
2. **Application domain activation** — contract, storage/writer guard, schemas, workflow and integration checks built on the stabilized Research domain.
3. **Agent transport layer** — a separate MCP-based sub-agent hub (detached runner, single-writer journal, lease fencing) proposed in its own pull request; integrating it with harness policy is an open design question.
4. **Live backend verification** — staged, human-authorized runs against real providers to replace mock-only evidence.
5. **Benchmarks** — protocol-first campaigns (scope, models, grading, budget, stopping rules), each run confirmed separately by a human.
6. **Public release** — once history, documentation and examples are reviewed for publication.

## License

[MIT](LICENSE). Vendored third-party code keeps its own license.
