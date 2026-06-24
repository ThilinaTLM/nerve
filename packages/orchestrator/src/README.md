# Orchestrator module ownership

The orchestrator owns daemon runtime effects and authority boundaries: HTTP routes, local auth, policy decisions, file-first repositories, task/worker management, tool approvals, and agent-run coordination.

- `registry.ts` remains the route-facing `RuntimeRegistry` facade and composition root.
- Every feature area lives under `domains/<area>/`, owning its repositories, services, and area-local types:
  - `domains/agents/` — agent lifecycle/authority/budget/status, prompt queue, suspension, and the agent `run/` engine (runner, child-agent foundation, message mirror, system-prompt builder).
  - `domains/conversations/` — conversation lifecycle/query, entries, the live `conversation-runtime`, `harness-manager`, and `operations/` (import/export/navigation/compaction/summary).
  - `domains/tools/` — `tool-service` facade, `agent-tool-adapter`, executor/dispatcher/policy, approvals, interaction sessions, and todo state.
  - `domains/tasks/` & `domains/workers/` — task supervision/logs/readiness and worker/agent-process management.
  - `domains/projects/`, `domains/pinned-commands/`, `domains/human-input/`, `domains/plans/`, `domains/git/`, `domains/usage/`, `domains/transcription/`.
- Files use the dotted `*.service.ts` / `*.repository.ts` convention within domains.
- `infrastructure/` (storage, events, index-store), `http/`, and `routes/` are cross-cutting layers shared by the domains; only genuinely cross-cutting composition/effects files (`main.ts`, `server.ts`, `index.ts`, `registry.ts`, `auth.ts`, `oauth-flow.ts`, `secrets.ts`, `credential-crypto.ts`, `logging.ts`, `resource-loader.ts`, `nerve-system-prompt.ts`) remain at `src/` root.
- `domains/tools/` execution plus managed task/explore-agent execution stay orchestrator-owned; `@nervekit/tools` only executes local core tools and intentionally rejects orchestrator-managed capabilities.

Keep transport-neutral schemas in `@nervekit/shared`, reusable harness/conversation mechanics in `@nervekit/agent`, and frontend presentation state in `packages/web`.
