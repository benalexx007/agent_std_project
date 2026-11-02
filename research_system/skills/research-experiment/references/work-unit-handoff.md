# Work-unit handoff

Work on the dispatched unit; its attempt ID, assignment generation and protocol version identify your output. Units already completed are context, not a request to rerun them.

Before a long step, check whether remaining context/budget can cover that step, verification and checkpoint. If not, save progress and yield rather than start work unlikely to reach a checkpoint.

A useful progress record contains:
- A short summary and remaining concrete actions.
- Stable artifact/diff paths with SHA-256 hashes.
- Checks actually performed and remaining uncertainty.
- External job IDs/handles and whether they still run.

Use save-checkpoint only for the current active assignment when the backend can actually write to the harness. CLI read-only workers do not have a midrun checkpoint channel; use bounded units and boundary checkpoints instead of claiming to have saved progress. Failed/cancelled/unknown or settled workers cannot publish new progress checkpoints. The runner derives final boundary checkpoints from validated results.

A checkpoint acknowledgement is different from scientific acceptance. Published output versions have immutable snapshots, while the latest public output still needs to match its hash. Historical inputs and evidence require their observed hashes. Only declared writable outputs can omit sha256 for harness pinning; this does not apply to planning sources or old inputs.

When a valid result is inconclusive, retain the missing checks and ask the orchestrator to review/reopen the unfinished units. Reopening does not reset budgets or authorize a declined decision; completed units with valid evidence can be retained. Change the task revision when the objective, protocol or declared inputs actually change.

After takeover, inspect the supplied checkpoint, input/protocol versions, pending jobs and current files. Continue only the remaining assigned unit. Do not relaunch an existing training/scheduler job. If state is unknown, report the evidence needed for reconciliation. Do not change the goal, permissions or success criteria to fit a new backend.
