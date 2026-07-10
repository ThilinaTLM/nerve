# Orchestrator module ownership

The orchestrator owns daemon runtime effects and authority boundaries: HTTP routes, local auth, policy decisions, file-first repositories, task/worker management, tool approvals, and agent-run coordination.

Root-level TypeScript files in `src/` are entrypoints only:

- `index.ts` is the public package export surface.
- `main.ts` is the executable daemon boot entrypoint exported as `@nervekit/workbench-server/main`.

Everything else lives under an ownership area:

- `app/` owns application composition: `OrchestratorState`, `createOrchestratorState`, Hono app setup, daemon status serialization, and version metadata.
- `runtime/` owns the route-facing `RuntimeRegistry` facade, runtime composition, runtime in-memory state, and runtime-local types.
- `domains/<area>/` owns feature behavior, repositories, services, and area-local types:
  - `domains/auth/` — provider credentials, OAuth login flows, credential envelope decryption, and provider auth metadata.
  - `domains/agents/` — agent lifecycle/authority/budget/status, prompt queue, suspension, and the agent `run/` engine.
  - `domains/agents/prompting/` — Nerve system-prompt construction and harness resource loading.
  - `domains/conversations/` — conversation lifecycle/query, entries, the live `conversation-runtime`, `harness-manager`, and `operations/`.
  - `domains/tools/` — `tool-service` facade, `agent-tool-adapter`, executor/dispatcher/policy, approvals, interaction sessions, and todo state.
  - `domains/tasks/` & `domains/workers/` — task supervision/logs/readiness and worker/agent-process management.
  - `domains/projects/`, `domains/pinned-commands/`, `domains/human-input/`, `domains/plans/`, `domains/git/`, `domains/usage/`, `domains/transcription/`, `domains/providers/`, `domains/storage/`, `domains/completions/`, `domains/runtime/`.
- `infrastructure/` owns durable/cross-cutting infrastructure:
  - `storage/`, `events/`, `index-store/`, `tls/`, `secrets/`, and `diagnostics/`.
- `http/` owns transport helpers and middleware.
- `routes/` owns HTTP route mounting and request/response adaptation.

Files use the dotted `*.service.ts` / `*.repository.ts` convention within domains.

Keep transport-neutral schemas in `@nervekit/contracts`, reusable harness/conversation mechanics in `@nervekit/harness`, and frontend presentation state in `packages/workbench-app`. Domains/tools execution plus managed task/explore-agent execution stay orchestrator-owned; `@nervekit/tools` only executes local core tools and intentionally rejects orchestrator-managed capabilities.
