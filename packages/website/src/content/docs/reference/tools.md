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

Reads are bounded and parallel-capable. `edit` accepts only `path` plus exact, unique `edits: [{ oldText, newText }]`; every match resolves against the original file and the write is atomic. Use `write` to replace an entire file. Bash is noninteractive and process-tree cancellable; use `launches.start` in `quick_script` for the user’s dev servers. Python accepts exactly one code/file source, has no stdin, and is capped at 600 seconds.

## Web and quick_script

- Web: `web_search`, `web_fetch`
- Scripts: `quick_script`

`web_fetch` is a core tool with its own switch. `web_search` comes from the Web Search extension: it needs a search account (Tavily today) and is off until you enable the extension. Python has a switch too. Both web tools are external reads. See [Web search and fetch](/integrations/web/).

`quick_script` runs a sandboxed TypeScript script that calls the SDK namespaces of the enabled [extensions](/integrations/extensions/): `jira`, `confluence`, `atlassian` and `storage` (Atlassian), `search` (Web Search), `diagram` and `imagegen`. It also always has `files`, `image`, `web.fetch`, `launches` (see Background processes), `extensions` and `configuration` (used by the built-in **configure-nerve** skill: `describe`, `list`, `tools.list`, `explain`, `check` and `reload` read and activate configuration the agent edited, and `extensions.reload` loads an extension folder; none of them grants trust), `mcp` (only while an [MCP server](/integrations/mcp/) is on), document libraries (XLSX, Papa, docx, mammoth, PptxGenJS, JSZip) and the `sdk` discovery helpers. The tool description lists only the namespaces that are on; the agent discovers methods inside the script with `sdk.describe`, `sdk.docs`, `sdk.search` and `sdk.list`. A call takes `code` and an optional `timeout` in seconds (default 120, at most 600). Each SDK call is an operation (`jira.issues.create`, `diagram.render`, `imagegen.generate`) checked against your permission policy. The Jira, Confluence, diagram-export and image-generation tools that existed before 0.41 are gone, as is the direct `launch` tool; extensions can add namespaces too. See [Batch work with Quick script](/guides/quick-script/).

## Images

- Explanation: `explain_image`
- Generation: the `imagegen` namespace of `quick_script`

`explain_image` comes from the Image explanation extension, which is off by default. Under **Settings → Extensions → Image explanation**, choose an image-capable model and a thinking level, then turn the extension on for your user or a project. If the selected model or its credentials are removed, the tool is unavailable and the extension page shows the fix. The tool accepts an absolute or project-relative JPEG, PNG, GIF, or WebP path (up to 20 MiB) and an optional focus prompt, sends the image to the configured vision model, and returns only bounded explanatory text to the primary model. It is a read-risk tool: the file is read under your `read` permission rules, and the image goes only to the model you selected, so rule sets that allow reads run it without asking. Cloud providers receive the image bytes; a compatible local provider can keep processing local.

`imagegen.generate` takes a prompt, an optional size, optional input images and optional backend options such as quality; backend and model defaults are extension settings. It is an external write that spends your subscription's image allowance. The generated image is saved as a conversation artifact and its handle is returned to the script, so it can be resized with `image(...)`, attached to a Confluence page, or read.

## Diagram rendering

The `diagram` namespace renders Mermaid, D2, PlantUML and other Kroki engines to PNG. The Diagrams extension is on by default and uses `https://kroki.io/` unless you set a trusted endpoint under **Settings → Extensions → Diagrams**. Diagram source is sent to that server; use a self-hosted endpoint for private diagrams.

## Interaction

- `ask_user`

Questions suspend a run until the user answers.

## Background processes

- `bash`: run a command, optionally with `background: true`
- `async_bash`: `list`, `logs`, `stop`

Bash accepts a project-relative or absolute `cwd` inside the project. With auto-promotion enabled, a still-running command moves to the background after the configured wait; there is no `timeout` parameter. With promotion disabled, foreground calls require `timeout` in seconds and are killed when it expires. Explicit background runs return at once and have no time limit. Their optional `ready` string is an HTTP(S) URL or output regex, checked for up to 60 seconds without stopping the process on readiness timeout.

Dev servers and other saved commands belong to the `launches` namespace of `quick_script`; there is no separate launch tool. Prefer the user's definitions in `.nerve/launches/definitions.json`; `launches.list()` returns definitions with their runs. `start`, `restart`, `stop` and `logs` take a name or `{ name?, runId? }`. A name is the label shown in the Launches panel (the command when unlabeled), or a `launchdef_` id. Duplicate names fail and list ids and folders; `runId` selects one run. Async Bash and agent-started launches notify the conversation on exit; do not poll. `logs` takes a 0-based `offset` and `lines` (default 100, maximum 500), returning the last lines when offset is omitted.

```ts
await launches.list(); // { definitions, folders, runs }
await launches.start("Web dev"); // command shown in the panel: pnpm dev
await launches.logs({ name: "Web dev", runId: "launch_…", lines: 100 });
await launches.restart({ name: "Web dev" });
await launches.stop("pnpm preview"); // command fallback for an unlabeled launch
await launches.create({ label: "Docs", command: "pnpm docs:dev", port: 4321 });
await launches.update({ name: "Docs", port: 4322 });
```

- Use `async_bash list` for running commands (`all: true` includes finished runs), `async_bash logs` to inspect output, and `async_bash stop` to end a process tree.
- Without `runId`, logs, stop, and restart select the latest run. Restart uses the current definition and starts it if nothing is running.
- `start` and `restart` are checked by command policy as the `bash` command they run, with its cwd, and count as destructive for a script's risk. `stop` is an external write; `list` and `logs` read. The catalog writes `create`, `update`, `remove`, `folders.create` and `move` edit the project's definitions; the agent never edits the file by hand.
- A `single` definition that is already running returns outcome `already_running`. If a definition declares a port, start and restart wait up to 30 seconds for it to listen. Port conflicts report the listener's PID and process name; agents never terminate foreign listeners.
- Large output is summarized with file paths for `read`/`grep` instead of filling the conversation context.
- Background Bash and agent-started launches queue a completion notice when they exit on their own. Launch notice ownership is held in memory and doesn't survive a daemon restart.

## MCP servers

Nerve connects to the MCP (Model Context Protocol) servers in `<NERVE_HOME>/config/mcp.json` (default `~/.nerve`) and in a project's `.nerve/config/mcp.json`, in the `mcpServers` shape other MCP clients use: stdio servers (`command`, `args`, `env`, `cwd`) and Streamable HTTP servers (`url`, `headers`), plus `description`, `enabled` and `timeout`. `${VAR}` references are expanded from Nerve's environment, and `${secret:name}` from secrets you store in Settings. You approve each entry once (entries you save in Settings are approved already), and a project entry replaces a user entry of the same name; manage them under **Settings → MCP servers**. Their tools are not separate tools: agents reach them through the `mcp` namespace of `quick_script`, which is listed in its description only while a server is on. See [MCP servers](/integrations/mcp/).

```ts
await mcp.servers.list(); // state, instructions
await mcp.tools.search({ query: "create issue", server: "github" });
await mcp.tools.get({ server: "github", tool: "create_issue" }); // inputSchema
await mcp.tools.call({
  server: "github",
  tool: "create_issue",
  arguments: { owner: "acme", repo: "web", title: "Bug" },
});
await mcp.resources.get({ server: "docs", uri: "docs://readme" });
```

- A server starts (or connects) on first use and is shared by later scripts; a stdio server runs once per project directory and stops after ten minutes unused.
- Each `tools.call` is checked as operation `mcp.tools.call` on target `mcp:tool/<server>/<tool>`, so an "always allow" covers one tool. Nerve cannot know what a tool does, so a script that calls one counts as destructive. Listing tools and reading resources are external reads.
- A tool's text blocks are returned as `text`, its structured result as `structured`, and images or binary content as artifacts in `files`. A tool that reports an error throws `SERVER_ERROR`.
- OAuth sign-in for MCP servers isn't supported; pass a token in `headers`.

## Removed tools

`todos_set` and `todos_get` no longer exist, and neither does the composer's todo chip. Older conversations show past todo calls as generic tool cards.

## Delegation and planning

- Sub-agents: `subagent_prompt`, `subagent_status`, `subagent_stop`
- Planning: `plan_present`

The Sub-agents tool group is disabled by default. With the group enabled but no usable profiles, existing children retain prompt follow-ups, status and stop; the prompt schema omits `profile`, and new-child creation fails. With no usable profiles and no existing children, the tools are hidden. Turning the master Sub-agents capability off hides the entire group even when children exist. `subagent_prompt` takes a batch of 1–10 assignments (`name`, optional `profile`, `prompt`) and optional shared `context`. A new name creates a sub-agent from the named [profile](/reference/agent-profiles/); an existing name queues a follow-up and resumes a stopped sub-agent. The whole batch is validated first, so a bad name, profile or duplicate fails the call and nothing is created. `subagent_status` lists sub-agents or shows one in detail, and `subagent_stop` stops the current execution of the named sub-agents.

Users select lead profiles in the composer, with `/profile <name>`, or with `/plan` (Planning). `plan_present` is disabled by default and enabled by the Planning profile: “Submit a plan file from plan storage for user review. Ends your turn; approval switches the conversation to the default profile for implementation.” Its `file_path` is inside plan storage; the tool description includes that directory's absolute path. Rejection keeps the profile and ends the run. Agents cannot switch profiles themselves.

Sub-agents run asynchronously in the lead's worktree and do not see the lead transcript. Their completion is delivered as a notice that wakes the lead. They never receive `ask_user`, `plan_present` or the sub-agent tools. Stopping a sub-agent keeps its history.

## Not agent tools

Workbench Git/GitHub routes and Agent Browser skill discovery are not tool names. Agents use Git through Bash; Agent Browser contributes optional prompt guidance.

Risks include read, workspace write, command, external read, external write, secret, destructive, agent spawn, deployment, and interaction. Read [tools and policy](/developers/tools-policy/) before treating a risk label as a security boundary.
