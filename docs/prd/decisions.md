# nerve Decisions

## D001: Use `@earendil-works/pi-ai` as an npm dependency

Status: accepted

`nerve` should consume Pi's provider layer from npm instead of copying it.

Package:

```txt
@earendil-works/pi-ai
```

Reasoning:

- LLM provider APIs and model lists change frequently.
- Pi already maintains provider compatibility across Anthropic, OpenAI, Google, Mistral, Bedrock, Azure, etc.
- Keeping this as an npm dependency allows easier model/provider updates.
- The provider layer is reasonably modular and already exported as a package.

Tradeoff:

- Provider behavior can change on package upgrades.
- Use exact versions and upgrade intentionally.

Initial dependency style:

```json
{
  "dependencies": {
    "@earendil-works/pi-ai": "0.78.0"
  }
}
```

## D002: Copy/adapt Pi `packages/agent`

Status: accepted

`nerve` should copy Pi's `packages/agent` source into its own monorepo and adapt it.

Reasoning:

- The harness/session/tool orchestration is where `nerve` needs freedom.
- Modes, permissions, process management, sub-agents, UI events, and durable recovery need deeper control than public APIs may expose.
- Copying the agent package keeps the provider layer external while allowing the harness to diverge.

Tradeoff:

- We must manually track upstream Pi agent improvements.
- Keep the initial copy clean to make future diffs easier.

## D003: Do not include Pi extension SDK initially

Status: accepted

The first version should not support Pi extensions/packages.

Reasoning:

- The target is a personal harness, not a public extensibility platform.
- Extension loading increases security and lifecycle complexity.
- Most desired features should be first-class built-ins: modes, permissions, sub-agents, process manager, tools.

Potential future:

- Add a small internal plugin interface later if repeated customization needs appear.

## D004: Build orchestrator/client architecture first

Status: accepted

`nerve` should be a daemon-owned harness with CLI and Web UI clients.

Reasoning:

- Browser UI can be much richer than terminal UI.
- CLI is still essential for project-local workflows and daemon bootstrap.
- The orchestrator must own API keys, filesystem access, shell execution, sessions, agents, approvals, and processes.
- WebSocket event streaming maps naturally to assistant/tool/process/approval events.

Default deployment:

```txt
local CLI + localhost Web UI served by nerve orchestrator
```

Security default:

- bind to `127.0.0.1`
- no API keys in browser
- token auth required for remote binding

## D005: Use append-only tree sessions

Status: accepted

Sessions should preserve Pi's tree-shaped JSONL design.

Reasoning:

- Branching is a core advantage over linear chat logs.
- UI can expose conversation history as a navigable tree.
- Durable model/tool/mode/permission changes can be branch-scoped.
- Compaction and branch summaries can be represented as normal entries.

## D006: Background processes are not bash commands

Status: accepted

Long-running processes should be managed by a process supervisor, not by the normal bash tool.

Reasoning:

- Dev servers need live logs, readiness detection, restart, and status.
- Agent and user should both inspect the same process logs.
- Blocking bash tools are bad for long-lived processes.

Initial process tools:

- `process_start`
- `process_stop`
- `process_restart`
- `process_list`
- `process_logs`

## D007: Modes are runtime state, not just prompt text

Status: accepted

Modes should control active tools, permissions, UI affordances, prompt addenda, and durable session state.

Reasoning:

- Mode behavior should be reliable and inspectable.
- Mutation restrictions should be enforced in code, not only requested in the prompt.
- The system prompt can remain small.

Initial primary modes:

- `planning`
- `coding`

Future modes such as `review`, `debug`, and `chat` can be added as focused variants or UI presets.

## D008: One local orchestrator, many agent processes

Status: accepted

`nerve` should have a singleton-ish orchestrator per user/machine, while agents are many and disposable.

Reasoning:

- A durable daemon can manage multiple projects/directories at once.
- Agent processes can be isolated, cancelled, restarted, and inspected independently.
- CLI, Web UI, and future API clients get a single control plane.
- This creates a natural path to remote workers later.

Important boundary:

- The CLI is a client/bootstrapper, not the long-running harness.
- Agents communicate with the orchestrator through a stable protocol.

## D009: Sub-agents are normal agents with parent metadata

Status: accepted

A sub-agent is an agent created by another agent through the orchestrator.

Reasoning:

- Avoids a separate special-case sub-agent runtime.
- Lets the UI render a real agent tree.
- Gives every child its own lifecycle, logs, permissions, and event stream.
- Lets the orchestrator enforce child budget, depth, scope, and permission rules.

Default:

```txt
sub-agent mode: planning
sub-agent permission: read_only
```

Rule:

- A child agent cannot receive broader authority than its parent unless the user explicitly approves escalation.

## D010: Modes and permission levels are orthogonal

Status: accepted

Mode defines objective. Permission level defines autonomy.

Initial modes:

- `planning`: research and produce a plan; no project mutation
- `coding`: implement/edit/test/debug when permission allows

Initial permission levels:

- `autonomous`: allowed actions run without prompting, subject to policy
- `supervised`: non-read-only actions require user approval
- `read_only`: mutating actions are rejected without prompting

Effective policy:

```txt
effective permission = mode constraints ∩ permission level ∩ tool policy ∩ workspace scope ∩ hard safety rails
```

Reasoning:

- Simple UX without conflating goals and access control.
- Works naturally for sub-agents.
- Allows plan mode to write to a plan sandbox while still preventing project edits.
- Lets users supervise coding agents without blocking harmless reads.

## D011: Planning mode may write only to a plan sandbox

Status: accepted

Planning mode should not modify project files. It may write planning artifacts into a dedicated sandbox.

Initial sandbox:

```txt
~/.nerve/plans/
```

Reasoning:

- Keeps planning productive while preventing accidental implementation.
- Matches the existing pi-toolbelt idea of guarded writes in plan mode.
- Makes plan documents durable and reviewable before coding begins.

## D012: Use `~/.nerve` as the default local data directory

Status: accepted

`nerve` should store its local durable state under:

```txt
${HOME}/.nerve
```

Reasoning:

- Keeps `nerve` data separate from Pi's `~/.pi` namespace.
- Matches the proven local harness pattern used by Pi and pi-toolbelt.
- Makes the system easy to inspect, back up, move, and clean up.

Future:

- Allow overrides with `NERVE_HOME` and/or `nerve --data-dir`.

## D013: Prefer file-first storage with SQLite as a rebuildable index

Status: accepted

Human-relevant durable data should be stored as readable files. SQLite should be used for fast lookup, active state, and UI queries.

Canonical file-backed data includes:

- sessions and session entries
- agent metadata and run logs
- process logs
- plans
- handovers
- approvals audit log
- project metadata

SQLite indexes include:

- recent sessions
- active agents
- pending approvals
- process status
- searchable event metadata

Reasoning:

- JSON/JSONL/Markdown files are easier to inspect and recover.
- Append-only JSONL matches the existing Pi agent storage style.
- Raw logs belong in files rather than database blobs.
- SQLite still gives the UI and API fast queries.
- If SQLite is lost, most indexes should be rebuildable from files.

## D014: Store secrets in OS keychain or encrypted files, never plaintext JSON

Status: accepted

API keys, auth tokens, and provider credentials must not be stored as plaintext JSON.

Preferred order:

1. OS keychain
2. encrypted file fallback under `~/.nerve/keys/*.enc` or `~/.nerve/auth/*.enc`

Readable metadata may exist, for example:

```txt
~/.nerve/keys/providers.json
```

but it must not contain raw secrets.

Reasoning:

- The file-first model should not compromise credentials.
- OS keychains are the best local default when available.
- Encrypted fallback keeps the system cross-platform.

## D015: Use crash-safe file writes

Status: accepted

The storage layer should use append-first and atomic-write patterns.

Rules:

- append JSONL for events, session entries, and approvals
- write JSON metadata via temp file + rename
- keep raw stdout/stderr logs as append-only files
- tolerate corrupt JSONL lines where possible and surface diagnostics
- fsync important files/directories where practical

Reasoning:

- Agents, dev servers, and the orchestrator may be interrupted.
- Local state should remain recoverable after crashes.
- Append-only records are easier to audit and repair.

## D016: Use plain Svelte 5 + Vite for the Web UI

Status: accepted

The first Web UI should be a plain Svelte 5 SPA built with Vite, not SvelteKit.

Reasoning:

- The orchestrator is already the backend.
- Static assets can be served by the orchestrator.
- Plain Svelte keeps the initial UI simple and local-app-like.
- Svelte's reactivity fits live agent events, logs, approvals, and panel-heavy UI well.

Future:

- SvelteKit can be reconsidered if file-based routing or framework conventions become valuable.

## D017: Use Bits UI with Nerve-owned design system wrappers

Status: accepted

Use Bits UI as the primary accessible headless primitive layer for Svelte.

Use Paneforge for resizable layout panes.

Reasoning:

- Bits UI provides accessible behavior without forcing visual design.
- Nerve should own its design system through CSS variables, Tailwind utilities, and custom wrapper components.
- Wrapping primitives avoids coupling application code directly to a third-party UI package.

Initial pattern:

```txt
Nerve UI component -> Bits UI primitive -> Tailwind classes + CSS variable tokens
```

## D018: Use TailwindCSS with CSS variable design tokens

Status: accepted

Styling should use TailwindCSS utilities backed by Nerve-owned CSS variable design tokens.

Reasoning:

- Fast implementation without giving up a coherent design system.
- Runtime theming is easier with CSS variables.
- Visual identity remains independent from the headless primitive library.

## D019: Use TanStack Svelte Query and Svelte stores/runes for UI state

Status: accepted

Use `@tanstack/svelte-query` for server/cache state and Svelte stores/runes for local UI state.

Reasoning:

- Query state and local UI state have different lifecycles.
- Svelte's built-in reactivity removes the need for Zustand.
- TanStack Query handles refetching, caching, invalidation, and async API ergonomics well.

## D020: Use Biome for formatting and linting

Status: accepted

Use Biome as the primary formatter/linter where supported, with `svelte-check` and TypeScript checks for Svelte/TS correctness.

Reasoning:

- Biome is fast and simple.
- One tool can cover most TypeScript/JavaScript/JSON/CSS formatting and linting.
- Svelte-specific diagnostics still need `svelte-check`.

If `.svelte` formatting support is insufficient, add the minimum Svelte-specific formatting support needed while keeping Biome as the default tool.

## D021: Use unified/remark/rehype + Shiki for markdown rendering

Status: accepted

Assistant output, plan files, handovers, and rich text artifacts should be rendered through a safe markdown pipeline.

Initial stack:

```txt
unified
remark-parse
remark-gfm
remark-rehype
rehype-sanitize
Shiki
```

Rules:

- assistant output is untrusted content
- raw HTML is disabled or sanitized
- code blocks use Shiki highlighting
- Mermaid or other executable/rendered blocks must be opt-in later

## D022: Use CodeMirror 6 for the prompt composer

Status: accepted

Use CodeMirror 6 for the main prompt composer instead of a basic textarea or custom contenteditable.

Reasoning:

- Robust multiline text editing.
- Built-in autocomplete support.
- Good keyboard shortcut support.
- Can support file/folder mentions, slash commands, and future symbol references.

Initial features:

- prompt text editing
- slash command suggestions
- file/folder suggestions
- send/newline keyboard behavior

## D023: Use strict ESM across all packages

Status: accepted

All packages should use strict ESM with Node.js 22+ as the required runtime.

Reasoning:

- Keeps the monorepo consistent and modern.
- Fits Vite, Svelte, Hono, and current TypeScript best practices.
- Avoids mixed CommonJS/ESM interop complexity.

Implementation expectations:

- package manifests should use `"type": "module"`.
- TypeScript config should target modern Node ESM.
- Prefer explicit file extensions where required by Node runtime output.

## D024: Use prefixed ULIDs for durable entity ids

Status: accepted

Durable entities should use prefixed ULID ids.

Examples:

```txt
proj_01...
ses_01...
agent_01...
run_01...
proc_01...
evt_01...
```

Reasoning:

- ULIDs are sortable by creation time.
- Prefixes make logs, file paths, URLs, and debugging clearer.
- IDs remain URL-safe and filesystem-friendly.

## D025: Use a local token file for foundation-phase daemon auth

Status: accepted

The local daemon should not expose an unauthenticated API. For the foundation phase, it may use a generated bearer token stored in:

```txt
~/.nerve/auth/local-token
```

The file must be created with user-only permissions where the platform supports it.

Reasoning:

- Keeps the first CLI/Web UI/daemon integration simple.
- Avoids delaying the foundation phase on keychain/encryption integration.
- Still prevents completely open local API access.

Future:

- Move auth tokens and OAuth sessions to keychain or encrypted file storage.

## D026: Route launches through durable worker records

Status: accepted

Agent processes and supervised background processes should be launched through a worker abstraction, even while all execution remains local.

Initial worker kind:

```txt
local
```

Initial durable record:

```txt
~/.nerve/workers/<worker-id>/worker.json
```

Reasoning:

- Preserves the simple local MVP while adding a clean seam for future remote workers.
- Lets agents and processes record where they were launched with `workerId`.
- Keeps worker capabilities explicit (`agent`, `process`) instead of assuming every execution target can do everything.
- Allows future remote-worker transports to reuse orchestrator-owned policy, event, and storage semantics.

Future remote-worker handshake requirements:

- mutual authentication between orchestrator and worker
- explicit operator approval of worker scope and capabilities
- encrypted transport with replay protection
- no raw provider-secret transfer unless explicitly opted into by the operator
- lifecycle/log/result reporting through transport-neutral event shapes

## D027: Manage provider credentials from the CLI only

Status: accepted

Provider API-key entry, subscription OAuth login, and credential removal should be exposed through CLI commands backed by daemon-owned APIs, not through Web UI controls.

Rules:

- The orchestrator/daemon owns encrypted credential storage, OAuth execution, token refresh, and per-run auth delivery.
- The CLI is a thin authenticated client that drives setup flows with `nerve auth ...` commands.
- The Web UI may show read-only configured-provider status and use it for model availability.
- Credential mutation endpoints require local bearer-token auth and must reject browser-cookie-only requests.
- Raw secrets are never returned by APIs or rendered in the browser.

Reasoning:

- Provider subscriptions and API keys change rarely, so terminal setup is acceptable.
- Terminal-driven setup matches the Pi coordination model.
- Removing credential mutation from browser code gives a clearer local security boundary than merely hiding forms.
- The Web UI remains focused on sessions, agents, approvals, logs, and model use rather than account administration.
