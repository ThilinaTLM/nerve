# Agent Instructions for nerve

## Working directory and sibling repositories

- Treat this repository (`/home/tlm/Projects/pi/nerve`) as the default working directory for `nerve` work.
- The parent directory also contains sibling repositories that are useful references:
  - `../pi`: the Pi agent harness monorepo. Use it as the main reference for code to copy/adapt, especially `packages/agent` and provider integration patterns. Do not modify it unless the user explicitly asks.
  - `../pi-toolbelt`: the Pi toolbelt repo that provides agent-facing workflow tools such as todos, ask-user, web search/fetch, plan mode, and process-log management. Use it as a reference for process-manager and agent-harness ergonomics. Do not modify it unless the user explicitly asks.
- When reading from sibling repositories, use explicit relative paths from `nerve`, for example `../pi/packages/agent` or `../pi-toolbelt/README.md`.
- Keep commits and staged changes scoped to `nerve` unless the user explicitly expands the task.

## Documentation structure

- `docs/prd/` is the source of truth for product requirements, architecture, protocols, storage, permissions, and technical decisions.
- Update PRD docs before changing behavior, architecture, protocols, storage, or policy semantics.

Key docs:

- `docs/prd/architecture.md`
- `docs/prd/tech-stack.md`
- `docs/prd/api-protocol.md`
- `docs/prd/storage.md`
- `docs/prd/modes-permissions.md`
- `docs/prd/decisions.md`
- `docs/plan/implementation-plan.md`
- `docs/plan/progress.md`

## Project philosophy

- Keep the agent prompt small and behavior-driven by code.
- Prefer explicit runtime state over hidden prompt conventions.
- The orchestrator owns dangerous capabilities: API keys, filesystem, shell, processes, permissions, and approvals.
- The browser is UI only.
- Agents are isolated workers. Sub-agents are normal child agents created through the orchestrator.
- Avoid adding a public extension/plugin system until there is a concrete need.

## Architecture direction

- Use a local singleton-ish orchestrator daemon with many agent processes.
- CLI and Web UI are clients of the orchestrator, not the harness itself.
- Use `@earendil-works/pi-ai` from npm for LLM providers.
- Copy/adapt Pi `packages/agent` for the harness core.
- Preserve tree-shaped append-only sessions.
- Make modes, permission levels, sub-agents, approvals, and background processes first-class runtime concepts.

## Tech stack requirements

- Use Node.js 22+.
- Use strict ESM across all packages; avoid CommonJS.
- Use pnpm workspaces.
- Use TypeScript-first code.
- Use Biome for formatting/linting where supported.
- Use `svelte-check` for Svelte diagnostics.
- Web UI: plain Svelte 5 + Vite, not SvelteKit initially.
- UI primitives: Bits UI wrapped by Nerve-owned components.
- Styling: TailwindCSS with CSS variable design tokens.
- Web server/orchestrator: Hono + WebSocket.
- Shared schemas/types: Zod in `packages/shared`.

## Storage and IDs

- Default data directory is `~/.nerve` unless explicitly overridden.
- Prefer file-first storage. Human-relevant durable records belong in readable JSON, JSONL, Markdown, or log files.
- SQLite is a rebuildable index/cache, not the only source of truth.
- Use crash-safe writes: append JSONL/logs and atomic JSON writes via temp file + rename.
- Durable entity ids use prefixed ULIDs, for example:
  - `proj_01...`
  - `ses_01...`
  - `agent_01...`
  - `run_01...`
  - `proc_01...`
  - `evt_01...`

## Security and permissions

- No provider API keys or raw secrets in frontend code.
- Do not store API keys in plaintext JSON.
- Prefer OS keychain or encrypted file storage for secrets.
- Foundation-phase local daemon auth may use `~/.nerve/auth/local-token` with user-only permissions.
- All filesystem, shell, process, and tool actions go through orchestrator policy enforcement.
- Planning mode must not mutate project files.
- `read_only` agents must receive automatic denial for mutating tools, not approval prompts.

## Protocol guidance

- Client/orchestrator protocol: HTTP JSON for commands/queries and WebSocket for event streams.
- Orchestrator/agent protocol: JSON-RPC 2.0 over stdio initially.
- Keep protocol types transport-neutral where practical for future remote workers.
- WebSocket/replay events use an envelope with `seq`, `id`, `ts`, `type`, and `data`.

## Implementation guidance

- Keep shared API/event/policy/storage types in `packages/shared`.
- Prefer small, explicit modules over framework magic.
- Do not implement real agent/model/tool complexity before the foundation pieces are in place.
- When adding a tool, declare its risk class and enforce policy in the orchestrator/tool layer.
- Long-running processes must use the process supervisor, not a blocking bash tool.
