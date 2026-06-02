# Orchestrator module ownership

The orchestrator owns daemon runtime effects and authority boundaries: HTTP routes, local auth, policy decisions, file-first repositories, process/worker management, tool approvals, and agent-run coordination.

Keep transport-neutral schemas in `@nerve/shared`, reusable harness/session mechanics in `@nerve/agent`, and frontend presentation state in `packages/web`.
