# Modes and Permissions

## Mental model

Modes and permissions are separate concepts.

```txt
Mode:        what the agent should focus on
Permission: what the agent is allowed to do
```

The orchestrator, not the agent prompt, enforces the final decision.

```txt
effective access = mode constraints ∩ permission level ∩ tool risk ∩ workspace scope ∩ hard safety rails
```

## Modes

Start with two primary modes.

### `planning`

Purpose:

- understand the task
- inspect code/docs
- ask clarifying questions
- propose a plan
- optionally write a plan artifact

Rules:

- may read/search the project
- must not modify project files
- may write only to the planning sandbox when permission allows

Default planning sandbox:

```txt
~/.nerve/plans/
```

### `coding`

Purpose:

- implement agreed changes
- edit project files
- run tests and debug
- update docs
- produce final result

Rules:

- may mutate the workspace only when permission and tool policy allow
- still respects workspace scope and hard safety rails

## Permission levels

### `autonomous`

The agent can perform allowed actions without prompting.

Still subject to:

- current mode
- workspace boundaries
- tool risk policy
- hard safety rails

### `supervised`

Read-only actions run freely. Non-read-only actions create an approval request.

Good default for interactive coding.

### `read_only`

Read-only actions run freely. Mutating actions are rejected automatically with a policy error. No user prompt is shown.

Good default for exploration sub-agents.

## Policy matrix

| Mode | Permission | Project edits | Plan-dir writes | Read/search |
| --- | --- | --- | --- | --- |
| planning | autonomous | no | yes | yes |
| planning | supervised | no | approval or yes by policy | yes |
| planning | read_only | no | no | yes |
| coding | autonomous | yes | yes | yes |
| coding | supervised | approval | approval | yes |
| coding | read_only | no | no | yes |

Key rule:

> Planning mode forbids project mutation even when permission is `autonomous`.

## Tool risk classes

Tools should declare a risk class before execution.

```ts
type ToolRisk =
  | "read"
  | "plan_write"
  | "workspace_write"
  | "command"
  | "network"
  | "secret"
  | "destructive"
  | "agent_spawn"
  | "deployment";
```

Examples:

- `read`: read file, list files, grep/search, git diff/status
- `plan_write`: create/update plan files under `~/.nerve/plans/`
- `workspace_write`: write/edit project files
- `command`: shell command; conservative unless classified as known read-only
- `network`: web fetch, API calls, package downloads
- `secret`: credential/API-key access
- `destructive`: deletes, resets, force operations
- `agent_spawn`: create or run a child agent (`subagent_run`)
- `deployment`: deploy, push, publish, production mutation

## Shell command policy

Shell is special because the command string may be read-only or mutating.

Recommended first implementation:

- allow known read-only commands as `read`
- require approval for unknown commands in `supervised`
- reject unknown commands in `read_only`
- treat dangerous patterns as `destructive`
- reject likely long-running dev/server/watch commands from normal `bash`; agents must use `process_start` so the orchestrator can supervise lifecycle and logs

Known read-like examples:

```txt
pwd
ls
find
rg
grep
git status
git diff
which
```

## Approval flow

When a tool call requires approval:

```txt
agent.tool_call.requested
policy.evaluated
approval.requested
approval.granted or approval.denied
agent.tool_call.completed or agent.tool_call.denied
```

The user approves through the Web UI or CLI. Agents may request escalation, but only the orchestrator/user can grant it.

## Sub-agent defaults

Sub-agents are normal agents spawned by a parent agent through the orchestrator.

Default child configuration:

```txt
mode: planning
permissionLevel: read_only
```

Rules:

- default `subagent_run` children are planning + read-only and may be allowed even for read-only research parents when they stay within parent authority
- child authority cannot exceed parent authority without explicit user approval
- child workspace scope cannot exceed parent workspace scope
- parent budget limits child depth and child-run count
- parent cancellation should cancel children recursively
- children have their own event streams and are visible as normal agents in the session's agent tree
- parent receives a summarized final result through the tool result
- UI can inspect the full child history

## Policy error behavior

Denied tool calls should return clear, actionable errors to the agent.

Example:

```txt
Tool denied: write_file is not allowed because this agent is in read_only permission level.
You may inspect files and return recommendations instead.
```

This lets the model adapt without relying on hidden behavior.
