# nerve Architecture

## Core mental model

`nerve` is a local-first AI harness built around a durable orchestrator.

```txt
nerve CLI ─────┐
               │
Web UI ────────┼──> nerve orchestrator / daemon
               │        │
API clients ───┘        │
                        ├── agent process: project A
                        ├── agent process: project B
                        ├── child agent process: spawned by agent A
                        ├── tool/process manager
                        ├── logs/events/artifacts
                        └── ~/.nerve files + SQLite index
```

The important distinction:

- **one orchestrator per user/machine by default**
- **many agents, across many projects/directories**
- **sub-agents are normal agents with parent metadata**

The orchestrator is the durable control plane. Agents are isolated, disposable workers.

## Design principles

1. **Small agent prompt, strong runtime**
   - Keep the base system prompt short and direct.
   - Put behavior in typed orchestration, tool policies, state machines, and UI flows instead of huge prompt instructions.

2. **Orchestrator-owned security boundary**
   - The browser is only a UI.
   - The CLI and Web UI are clients of the orchestrator.
   - The orchestrator owns API keys, filesystem access, shell execution, process management, sessions, approvals, and agent lifecycle.

3. **Modes and permissions are orthogonal**
   - Mode defines the agent's current objective.
   - Permission level defines what the agent may do without, with, or despite supervision.
   - Effective access is the intersection of mode constraints, permission level, tool policy, and workspace scope.

4. **Durable evented agent tree**
   - Agents form a parent/child tree.
   - Sessions and events are durable and replayable.
   - Branching, compaction, model changes, mode changes, permission changes, and child-agent events are represented as durable entries.

5. **First-class developer workflow support**
   - Long-running dev servers are managed processes, not hidden bash calls.
   - Background processes, logs, errors, approvals, and restarts are visible to both the agent and the user.

6. **Own the harness, reuse the providers**
   - Use `@earendil-works/pi-ai` from npm for LLM providers and model metadata.
   - Copy/adapt Pi's `packages/agent` so `nerve` can evolve its runtime freely.

## Runtime components

```txt
packages/cli
  nerve command, daemon bootstrap, attach/list/stop commands, local auth setup

packages/web
  plain Svelte + Vite SPA for sessions, agent tree, events, tools,
  approvals, logs, processes, markdown output, and prompt composer

packages/orchestrator
  HTTP + WebSocket API, singleton daemon, agent registry, policy engine,
  process supervisor, approval queue, durable state, web app serving

packages/agent
  copied/adapted Pi harness running as isolated worker processes

packages/tools
  tool implementations and risk classification

packages/shared
  shared protocol, event, policy, session, model, storage, and API schema types

external npm dependency
  @earendil-works/pi-ai
```

## Package layout

Proposed monorepo layout:

```txt
nerve/
  packages/
    cli/
    web/
    orchestrator/
    agent/
    tools/
    shared/
  docs/
  package.json
  tsconfig.json
```

## CLI application

The CLI is a client and bootstrapper, not the long-running harness itself.

Example commands:

```txt
nerve                 # start daemon if needed and open/print UI URL
nerve daemon          # run orchestrator in foreground
nerve ui              # open the local Web UI
nerve run [dir]       # create/attach an agent session for a project
nerve attach <id>     # attach to an existing session/agent
nerve agents list     # list active and recent agents
nerve stop <id>       # stop an agent/process/session
```

If the daemon is not running, client commands may auto-start it.

## Web UI architecture

The first Web UI is a plain Svelte 5 SPA built with Vite and served by the orchestrator.

Core stack:

- Svelte 5
- TailwindCSS
- CSS variable design tokens
- Bits UI headless primitives
- Paneforge resizable panes
- `@tanstack/svelte-query` for server/cache state
- Svelte stores/runes for local UI state
- CodeMirror 6 prompt composer
- unified/remark/rehype + Shiki markdown rendering

The UI should wrap headless primitives in Nerve-owned components rather than using third-party primitives directly throughout the app.

```txt
packages/web/src/
  api/
  design/
  stores/
  lib/components/ui/
  lib/components/agent/
  lib/components/session/
  lib/components/tools/
  lib/components/processes/
  lib/components/approvals/
```

State split:

```txt
TanStack Svelte Query -> server/cache state
Svelte stores/runes     -> selected items, layout, composer draft, theme, event buffers
```

Markdown output is treated as untrusted content and must be sanitized before HTML rendering.

## Orchestrator responsibilities

The orchestrator owns:

- singleton local daemon lifecycle
- web app serving
- HTTP commands and WebSocket event stream
- project/session/agent registry
- agent process supervision
- parent/child agent relationships
- tool registry and policy enforcement
- permission and approval decisions
- workspace boundary enforcement
- background process supervision
- durable state and event persistence
- API key/model/provider registry
- crash/orphan recovery

Agents are informed of their mode and permissions, but enforcement happens in the orchestrator/tool layer.

## Agent process model

An agent process is an isolated worker with:

- `agentId`
- `sessionId`
- `projectId`
- `projectDir`
- `parentAgentId`, if spawned by another agent
- `rootAgentId`
- `mode`
- `permissionLevel`
- `workspaceScope`
- model/provider config
- tool policy snapshot
- budget/resource limits

Agents communicate with the orchestrator using a stable protocol. They do not directly spawn unmanaged OS processes or child agents.

## Communication model

Start simple and cross-platform:

```txt
HTTP      commands/queries
WebSocket live events and event replay
```

Default binding:

```txt
127.0.0.1:<port>
```

This supports the CLI, browser UI, and future API clients. Later remote execution can reuse the same conceptual protocol through secure transports such as TLS WebSockets, gRPC, SSH tunnels, or a worker-node protocol.

## Storage and state model

`nerve` uses a file-first local data directory:

```txt
~/.nerve/
```

Human-relevant durable data is stored as readable files. SQLite is used as an index/cache/query accelerator, not as the only source of truth.

```txt
files = canonical durable records and artifacts
SQLite = fast lookup, active state, UI queries, recovery index
```

Proposed top-level layout:

```txt
~/.nerve/
  config.json
  state.sqlite
  auth/
  keys/
  projects/
  sessions/
  agents/
  plans/
  handovers/
  proc/
  approvals/
  logs/
```

Core file-backed records:

- project metadata: `projects/<project-id>/project.json`
- session tree and events: `sessions/<session-id>/entries.jsonl`, `events.jsonl`
- agent metadata and run logs: `agents/<agent-id>/...`
- process metadata and raw logs: `proc/<process-id>/...`
- plan artifacts: `plans/*.md` + metadata JSON
- approval audit log: `approvals/approvals.jsonl`

SQLite indexes:

- `projects`
- `sessions`
- `agents`
- `agent_runs`
- `events_index`
- `tool_calls`
- `approvals`
- `processes`
- `artifacts`
- `workers`

Important relationships:

```txt
project -> sessions -> agents -> runs/events/tool_calls
agent.parentAgentId -> parent agent
agent.rootAgentId -> root of the delegation tree
agent.workerId -> where the process is running
```

If SQLite is deleted or corrupted, the orchestrator should be able to rebuild most indexes from the file tree. See [Storage Model](storage.md).

## Event stream

Everything important should become an event:

- `agent.started`
- `agent.output.delta`
- `agent.tool_call.requested`
- `policy.evaluated`
- `approval.requested`
- `approval.granted`
- `approval.denied`
- `agent.tool_call.completed`
- `agent.spawn_requested`
- `agent.spawned`
- `agent.completed`
- `agent.failed`
- `agent.cancelled`
- `process.started`
- `process.log`
- `artifact.created`

The Web UI, CLI, logs, parent agents, and API clients consume the same stream.

## Modes

Modes define the agent's objective and UI/prompt posture.

Initial modes:

- `planning`: research, understand, ask questions, and produce a plan; project mutation is forbidden
- `coding`: implement, edit, test, debug, and update project files when permission allows

Future modes can be aliases or focused variants (`review`, `debug`, `chat`), but the first implementation should keep the primary model simple.

Planning mode may allow writes only to a planning sandbox, for example:

```txt
~/.nerve/plans/
```

It must not modify the project workspace even when the agent has autonomous permission.

## Permission levels

Permission level defines autonomy.

### `autonomous`

The agent may execute allowed tools without prompting, subject to mode, workspace, and hard safety rails.

### `supervised`

Read-only actions run freely. Non-read-only actions require user approval.

### `read_only`

Read-only actions are allowed. Mutating actions are rejected automatically with a clear policy error. No approval prompt is shown.

This is the default for exploration sub-agents.

## Effective policy

Effective access is always an intersection:

```txt
effective permission = mode constraints ∩ permission level ∩ tool policy ∩ workspace scope ∩ hard safety rails
```

Examples:

| Mode | Permission | Project edits | Plan-dir writes | Read/search |
| --- | --- | --- | --- | --- |
| planning | autonomous | no | yes | yes |
| planning | supervised | no | approval or yes by policy | yes |
| planning | read_only | no | no | yes |
| coding | autonomous | yes | yes | yes |
| coding | supervised | approval | approval | yes |
| coding | read_only | no | no | yes |

Hard safety rails may still require approval in autonomous mode, for example deployments, secret access, destructive deletes, remote git pushes, or system-level changes.

## Tool risk classification

Tools should be classified by risk:

- `read`
- `plan_write`
- `workspace_write`
- `command`
- `network`
- `secret`
- `destructive`
- `agent_spawn`
- `deployment`

Shell commands are conservative by default. Known read-like commands (`ls`, `rg`, `grep`, `git status`, `git diff`, etc.) can be allowed as read actions. Unknown commands are treated as potentially mutating.

## Sub-agents

A sub-agent is just an agent started by another agent through the orchestrator.

Rules:

- parent agents request child creation; the orchestrator decides and spawns
- children have their own `agentId`, `sessionId`, events, permissions, and lifecycle
- child authority cannot exceed parent authority unless the user explicitly approves escalation
- default child agents are `planning` + `read_only`
- parent receives a summarized child result; UI can inspect full child history

Initial rule: avoid unbounded recursive spawning. Allow a controlled depth/budget.

## Background process management

Long-running processes are not normal bash commands.

The orchestrator owns a process supervisor with:

- stable process id/name
- command and cwd
- status
- captured stdout/stderr logs
- readiness detection
- error/warning extraction
- restart support
- log query support

Agents get tools for process control and log inspection. The UI gets live process events.

## Compaction and branch summaries

Long sessions are kept usable with durable context entries owned by the orchestrator:

- manual compaction appends a `compaction` system entry and matching harness JSONL compaction entry
- optional auto-compaction triggers when the configured token threshold is exceeded
- branch navigation can append a `branch_summary` entry for the abandoned branch
- sub-agent completion records a `subagent_summary` artifact in the parent session
- future agent prompts rebuild context through the harness session helpers so compacted summaries replace old history while recent kept entries remain available

Initial summarization may be local/extractive; provider-backed summarization can replace it without changing the storage or API shape.

## Future distributed execution

Start with one local orchestrator and local agent workers. Design the protocol so future workers can run elsewhere:

```txt
nerve orchestrator
  ├── local worker
  ├── remote worker: development machine
  ├── remote worker: CI machine
  └── remote worker: GPU/server box
```

Remote workers should connect outbound to the orchestrator over a secure authenticated channel. This is future work, not MVP scope.

## Security model

Default local-first security:

- bind orchestrator to `127.0.0.1` by default
- never expose API keys to browser
- all filesystem access goes through orchestrator tools
- enforce workspace root allowlist
- require explicit opt-in for remote binding
- require token auth for non-local access
- log tool/process/approval actions for auditability
