# Orchestrator module ownership

The orchestrator owns daemon runtime effects and authority boundaries: HTTP routes, local auth, policy decisions, file-first repositories, process/worker management, tool approvals, and agent-run coordination.

- `registry.ts` remains the route-facing `RuntimeRegistry` facade and composition root.
- `registry/project-lifecycle-service.ts`, `registry/session-lifecycle-service.ts`, and `registry/agent-lifecycle-service.ts` own project/session/agent persistence choreography and mutable lifecycle state updates.
- Session operation services own import/export/navigation/compaction behavior behind the registry facade.
- `ToolService` and process/subagent execution stay orchestrator-owned; `@nerve/tools` only executes local core tools and intentionally rejects orchestrator-managed capabilities.

Keep transport-neutral schemas in `@nerve/shared`, reusable harness/session mechanics in `@nerve/agent`, and frontend presentation state in `packages/web`.
