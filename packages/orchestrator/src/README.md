# Orchestrator module ownership

The orchestrator owns daemon runtime effects and authority boundaries: HTTP routes, local auth, policy decisions, file-first repositories, process/worker management, tool approvals, and agent-run coordination.

- `registry.ts` remains the route-facing `RuntimeRegistry` facade and composition root.
- `domains/<area>/` owns each feature area's repositories, services, and area-local types (e.g. `domains/projects/project.service.ts` `ProjectLifecycleService`, `domains/conversations/conversation-lifecycle.service.ts` `ConversationLifecycleService`, `domains/agents/agent-lifecycle.service.ts` `AgentLifecycleService`) — the persistence choreography and mutable lifecycle state updates behind the registry facade.
- `infrastructure/` (storage, events, index-store), `http/`, and `routes/` are cross-cutting layers shared by the domains.
- Conversation operation services (`conversation-operations/`) own import/export/navigation/compaction behavior behind the registry facade.
- `ToolService` and process/subagent execution stay orchestrator-owned; `@nerve/tools` only executes local core tools and intentionally rejects orchestrator-managed capabilities.

Keep transport-neutral schemas in `@nerve/shared`, reusable harness/conversation mechanics in `@nerve/agent`, and frontend presentation state in `packages/web`.
