# subagent-hub

A local prototype transport layer that lets an orchestrating GUI agent (Claude Code, Codex or Antigravity) hand work to sub-agents on any of those backends through one uniform, non-blocking interface.

> **Status: prototype.** The test suite (104 tests) runs against fake backends only. No real backend has been exercised end to end, and the hub is not yet wired into the Research harness in `research_system/`. See [docs/07-design-r3.1.md](docs/07-design-r3.1.md) §7 for the list of checks that still need a human.

## How it works

- An MCP server (stdio) runs inside the orchestrator and only writes requests to an on-disk store; it never blocks on a backend.
- Each task gets a **detached runner** that survives the GUI, holds a lease on a named pipe and is the **single writer** of that task's journal.
- The runner executes the real backend (`claude -p`, `codex exec`, `agy`) through an adapter, inside a Windows Job Object (`jobrun`) so cancel kills the whole process tree.
- Results are normalized into one envelope, with retry, resume, follow-up and time-aware cancel.
- The orchestrator receives a `task_id` and collects results with `subagent_wait`, an inbox hook, or a background `orch wait`.
- Policy is a set of no-op hook points (`src/lib/hooks.mjs`): routing, spawn permission, per-attempt grants, failover, resume, result filtering, budget. Concrete policy is intentionally left open.

## Layout

| Path | Contents |
|---|---|
| `src/` | Node.js ≥ 22 implementation, standard library only, Windows-first (`src/README.md` has MCP registration examples per GUI) |
| `src/test/` | `node:test` suites and a fake backend fixture |
| `docs/` | Design rounds r1–r3.1 with the critique after each round; `07-design-r3.1.md` is current. Written mostly in Vietnamese. |

## Try it

```powershell
cd src
npm test            # no real backend is called
node bin/orch.mjs doctor
```

## Roadmap

1. Manual verification against real backends (checklist in the design doc).
2. Decide how hub policy is sourced and how it relates to the harness (single source of truth, human-gate behaviour, backend and model tiers, skill injection).
3. Integrate with the Research harness so delegated work goes through its publication journal and fencing instead of bypassing them.
4. Linux/macOS parity for the Windows-specific pieces (Job Object, named-pipe lease).
