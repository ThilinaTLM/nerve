# nerve

`nerve` is a UI-first personal AI coding harness inspired by Pi's simple agent architecture.

The goal is to keep the agent core small and explicit while adding first-class support for:

- CLI + Web UI clients backed by a local orchestrator daemon
- file-first local storage under `~/.nerve`
- tree-shaped durable sessions and event streams
- planning/coding modes with explicit permission levels
- sub-agents as normal child agents
- managed background processes and logs
- Svelte Web UI with Nerve-owned design system
- safe markdown rendering and CodeMirror prompt composer
- coding tools for file and shell work
- multi-provider LLM support via `@earendil-works/pi-ai`
- subscription auth for ChatGPT Plus/Pro (`openai-codex`) and Anthropic OAuth through daemon-managed encrypted credentials

## Core direction

`nerve` will reuse Pi's LLM provider package as an npm dependency:

```txt
@earendil-works/pi-ai
```

The agent/harness layer will be copied and adapted from Pi's `packages/agent` so `nerve` can own its orchestration model, session semantics, UI event protocol, planning modes, process manager, and sub-agent behavior.

## Intended architecture

```txt
nerve CLI ─────┐
               │
Web UI ────────┼──> Nerve orchestrator / daemon
               │        │
API clients ───┘        ├── agent process: project A
                        ├── agent process: project B
                        └── child agent processes
```

The orchestrator owns sessions, tools, auth, process management, permissions, approvals, and agent lifecycle. Agent processes use `@earendil-works/pi-ai` for provider access.

See:

- [Docs Index](docs/README.md)
- [Architecture](docs/prd/architecture.md)
- [Tech Stack](docs/prd/tech-stack.md)
- [API Protocol](docs/prd/api-protocol.md)
- [Modes and Permissions](docs/prd/modes-permissions.md)
- [Storage Model](docs/prd/storage.md)
- [Decisions](docs/prd/decisions.md)
- [Implementation Plan](docs/plan/implementation-plan.md)
- [Progress](docs/plan/progress.md)

## Non-goals for the first version

- no Pi extension SDK
- no package/plugin marketplace
- no terminal TUI clone
- no large system prompt framework
- no MCP-first design

These can be added later if they prove necessary, but the first version should stay intentionally small.
