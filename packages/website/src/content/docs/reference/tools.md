---
title: Agent tool catalog
description: Agent-callable tools, availability gates, risks, and important limits.
sidebar:
  order: 3
---

Nerve exposes the tool names below. The contracts and manifest own the exact catalog; availability also depends on profile, permission, runtime discovery, module settings, and user toggles.

## Files and execution

- Inspection: `read`, `grep`, `find`, `ls`
- Editing: `edit`, `write`
- Execution: `bash`, `python_exec`

Reads are bounded and parallel-capable. `edit` accepts only `path` plus exact, unique `edits: [{ oldText, newText }]`; every match resolves against the original file and the write is atomic. Use `write` to replace an entire file. Bash is noninteractive and process-tree cancellable; use `launch` for the user’s dev servers. Python accepts exactly one code/file source, has no stdin, and is capped at 600 seconds.

## Web and quick_script

- Web: `web_search`, `web_fetch`
- Scripts: `quick_script`

Web search/fetch, image explanation, and Python are individual global tool toggles. Search requires Tavily and uses the account selected in the Web extension. Jira, Confluence, diagram rendering and image generation have no tools of their own: `quick_script` runs a sandboxed TypeScript script that calls the `jira`, `confluence`, `diagram` and `imagegen` namespaces of the enabled [extensions](/guides/settings/), and the tool description lists only the namespaces that are on. Each SDK call is an operation (`jira.issues.create`, `diagram.render`, `imagegen.generate`) checked against your permission policy, and the agent discovers methods inside the script with `sdk.describe` and `sdk.docs`. See [Jira](/integrations/jira/) and [Confluence](/integrations/confluence/).

## Images

- Explanation: `explain_image`
- Generation: the `imagegen` namespace of `quick_script`

Choose an image-capable fallback model and its thinking level under **Settings → Tools**, then explicitly enable image explanation. `explain_image` is exposed only when the current agent model is text-only. It accepts an absolute or project-relative JPEG, PNG, GIF, or WebP path and an optional focus prompt, sends the image to the configured vision model, and returns only bounded explanatory text to the primary model. Cloud providers receive the image bytes; a compatible local provider can keep processing local.

Enable the Image generation extension in **Settings → Extensions** (with Quick script on). `imagegen.generate` takes a prompt and optional size while backend, model, and quality defaults remain user-owned settings. The generated image is saved as a conversation artifact and its handle is returned to the script, so it can be resized with `image(...)`, attached to a Confluence page, or read. The OpenAI Codex backend uses ChatGPT subscription image access rather than OpenAI API-key billing.

## Diagram rendering

The `diagram` namespace of `quick_script` renders Mermaid, D2, PlantUML and other Kroki engines to PNG. It is on by default. Configure a trusted Kroki endpoint under **Settings → Extensions → Diagrams**. Diagram source is sent to that server; use a self-hosted endpoint for private diagrams. See [diagram settings and limits](/guides/settings/#diagram-rendering).

## Interaction and to-dos

- `ask_user`
- `todos_set`, `todos_get`

Questions suspend a run. To-dos are structured current-work state, not background processes.

## Background processes

- `bash`: run a command, optionally with `background: true`
- `async_bash`: `list`, `logs`, `stop`
- `launch`: `status`, `logs`, `start`, `restart`, `stop`

Bash accepts a project-relative or absolute `cwd` inside the project. With auto-promotion enabled, a still-running command moves to the background after the configured wait; there is no `timeout` parameter. With promotion disabled, foreground calls require `timeout` in seconds and are killed when it expires. Explicit background runs return at once and have no time limit. Their optional `ready` string is an HTTP(S) URL or output regex, checked for up to 60 seconds without stopping the process on readiness timeout.

Check `launch status` before starting a server; prefer the user's definitions in `.nerve/launches/definitions.json`. Agents cannot create or edit definitions. Launch actions select an exact, case-sensitive `name` (the trimmed label, or trimmed command when unnamed); `status` takes no selector. `logs`, `stop`, and `restart` optionally accept `runId` from status, otherwise they select the latest run. `start` accepts only `name`. Definition IDs and the old `id` argument are not selectors. Duplicate saved names require renaming in the UI even when a run ID is supplied. See [Launch tool details](#launch-tool-details). Async Bash and agent-started launches notify the conversation on exit; do not poll. Both log tools use a 0-based `offset` and `limit` (default 100, maximum 500), returning the last lines when offset is omitted. Read actions never ask for approval; start, restart, and stop use command policy.

### Launch tool details

| Action            | Arguments                                   |
| ----------------- | ------------------------------------------- |
| `status`          | none                                        |
| `start`           | `name`                                      |
| `logs`            | `name`, optional `runId`, `offset`, `limit` |
| `stop`, `restart` | `name`, optional `runId`                    |

```ts
launch({ action: "start", name: "Web dev" }); // command shown by status: pnpm dev
launch({ action: "logs", name: "Web dev", runId: "launch_…", limit: 100 });
launch({ action: "restart", name: "Web dev" });
launch({ action: "stop", name: "pnpm preview" }); // command fallback for an unnamed launch
```

- Use `async_bash list` for running commands (`all: true` includes finished runs), `async_bash logs` to inspect output, and `async_bash stop` to end a process tree.
- Without `runId`, logs, stop, and restart select the latest run. A run ID from status targets one execution of that name; mismatched names or projects are rejected. Restart uses the current definition and starts it if nothing is running.
- Saved definitions are matched before ad-hoc launches. Duplicate saved names fail even with a run ID; rename them in the UI. Distinct ad-hoc launches with the same display name need a run ID.
- A `single` definition that is already running returns its active launch. If a definition declares a port, start and restart wait up to 30 seconds for it to listen. Port conflicts report the listener's PID and process name; agents never terminate foreign listeners.
- Large output is summarized with file paths for `read`/`grep` instead of filling the conversation context.
- Background Bash and agent-started launches queue a completion notice when they exit on their own. Launch notice ownership is held in memory and doesn't survive a daemon restart.

## Delegation and planning

- Sub-agents: `subagent_prompt`, `subagent_status`, `subagent_stop`
- Planning: `plan_present`

The Sub-agents tool group is disabled by default. With the group enabled but no usable profiles, existing children retain prompt follow-ups, status and stop; the prompt schema omits `profile`, and new-child creation fails. With no usable profiles and no existing children, the tools are hidden. Turning the master Sub-agents capability off hides the entire group even when children exist. `subagent_prompt` takes a batch of 1–10 assignments (`name`, optional `profile`, `prompt`) and optional shared `context`. A new name creates a sub-agent from the named [profile](/reference/agent-profiles/); an existing name queues a follow-up and resumes a stopped sub-agent. The whole batch is validated first, so a bad name, profile or duplicate fails the call and nothing is created. `subagent_status` lists sub-agents or shows one in detail, and `subagent_stop` stops the current execution of the named sub-agents.

Users select lead profiles in the composer, with `/profile <name>`, or with `/plan` (Planning). `plan_present` is disabled by default and enabled by the Planning profile: “Submit a plan file from plan storage for user review. Ends your turn; approval switches the conversation to the default profile for implementation.” Its `file_path` is inside plan storage; the tool description includes that directory's absolute path. Rejection keeps the profile and ends the run. Agents cannot switch profiles themselves.

Sub-agents run asynchronously in the lead's worktree and do not see the lead transcript. Their completion is delivered as a notice that wakes the lead. They never receive `ask_user`, `plan_present` or the sub-agent tools. Stopping a sub-agent keeps its history.

## Not agent tools

Workbench Git/GitHub routes and Agent Browser skill discovery are not tool names. Agents use Git through Bash; Agent Browser contributes optional prompt guidance.

Risks include read, workspace write, command, network, secret, destructive, agent spawn, deployment, and interaction. Read [tools and policy](/developers/tools-policy/) before treating a risk label as a security boundary.
