---
title: Agent tool catalog
description: Agent-callable tools, availability gates, risks, and important limits.
sidebar:
  order: 3
---

Nerve exposes the tool names below. The contracts and manifest own the exact catalog; availability also depends on mode, permission, runtime discovery, module settings, and user toggles.

## Files and execution

- Inspection: `read`, `grep`, `find`, `ls`
- Editing: `edit`, `write`
- Execution: `bash`, `python_exec`

Reads are bounded and parallel-capable. `edit` accepts only `path` plus exact, unique `edits: [{ oldText, newText }]`; every match resolves against the original file and the write is atomic. Use `write` to replace an entire file. Bash is noninteractive and process-tree cancellable; use `launch` for the user’s dev servers. Python accepts exactly one code/file source, has no stdin, and is capped at 600 seconds.

## Web and Atlassian

- Web: `web_search`, `web_fetch`
- Jira reads: `jira_search_users`, `jira_search_issues`, `jira_get_issue`, `jira_get_project`, `jira_search_boards`, `jira_get_board`, `jira_get_sprint`, `jira_download_attachment`
- Jira writes: `jira_create_issue`, `jira_update_issue`, `jira_transition_issue`, `jira_manage_comment`, `jira_manage_worklog`, `jira_manage_issue_link`, `jira_manage_attachment`, `jira_manage_sprint`, `jira_manage_backlog`
- Confluence reads: `confluence_search_spaces`, `confluence_search_pages`, `confluence_get_page`, `confluence_download_page`
- Confluence writes: `confluence_create_page`, `confluence_update_page`, `confluence_manage_comment`, `confluence_manage_page`, `confluence_manage_label`, `confluence_manage_restriction`, `confluence_manage_attachment`

Web search/fetch, image explanation, and Python are individual global tool toggles. Search requires Tavily. Jira/Confluence are enabled and assigned an Atlassian profile per user, project, or conversation; Web search uses the selected Tavily profile. Atlassian responses and mutation reports are always saved as managed raw artifacts while the agent receives a bounded semantic preview. Related Jira/Confluence data is selected with each read tool's compact `include` array.

## Images

- Explanation: `explain_image`
- Generation: `generate_image`

Choose an image-capable fallback model and its thinking level under **Settings → Tools**, then explicitly enable image explanation. `explain_image` is exposed only when the current agent model is text-only. It accepts an absolute or project-relative JPEG, PNG, GIF, or WebP path and an optional focus prompt, sends the image to the configured vision model, and returns only bounded explanatory text to the primary model. Cloud providers receive the image bytes; a compatible local provider can keep processing local.

Configure and enable image generation separately. `generate_image` accepts a prompt while provider, model, and output options remain user-owned settings. The generated raster file is retained as a tool-call artifact and its path is returned to the agent. The initial OpenAI Codex integration uses ChatGPT subscription image access rather than OpenAI API-key billing.

## Interaction and to-dos

- `ask_user`
- `todos_set`, `todos_get`

Questions suspend a run. To-dos are structured current-work state, not background processes.

## Background processes

- `bash`: run a command, optionally with `background: true`
- `async_bash`: `list`, `logs`, `stop`
- `launch`: `status`, `logs`, `start`, `restart`, `stop`

Bash accepts a project-relative or absolute `cwd` inside the project. With auto-promotion enabled, a still-running command moves to the background after the configured wait; there is no `timeout` parameter. With promotion disabled, foreground calls require `timeout` in seconds and are killed when it expires. Explicit background runs return at once and have no time limit. Their optional `ready` string is an HTTP(S) URL or output regex, checked for up to 60 seconds without stopping the process on readiness timeout.

Check `launch status` before starting a server; prefer the user's definitions in `.nerve/launches/definitions.json`. Agents cannot create or edit definitions. Launch actions accept a definition or launch ID; `status` takes no ID. Async Bash and agent-started launches notify the conversation on exit; do not poll. Both log tools use a 0-based `offset` and `limit` (default 100, maximum 500), returning the last lines when offset is omitted. Read actions never ask for approval; start, restart, and stop use command policy.

## Delegation, Explore, and planning

- Persistent teammates: `subagent_new`, `subagent_prompt`, `subagent_list`, `subagent_status`, `subagent_stop`
- Bounded research: `explore`
- Planning: `plan_mode_enter`, `plan_mode_present`, `plan_mode_force_exit`

The Async Subagents tool group is disabled by default. It lets a lead create named autonomous developer teammates, assign only idle teammates, inspect or list them, and stop an active assignment. Teammates share the project worktree, retain their own context for follow-ups, and do not automatically receive the lead transcript. Up to four assignments can be active for one lead. Completion is delivered durably and can wake the lead; stopping does not delete the teammate's history.

Explore accepts 1–8 child tasks, with 8 active and 24 total launches per parent run. Explore children are temporary, isolated/read-only, and receive only `read`, `grep`, `find`, `ls`, `async_bash` reads, and `launch` reads. Unlike persistent teammates, they report on one research assignment and cannot modify the shared worktree.

## Not agent tools

Workbench Git/GitHub routes and Agent Browser skill discovery are not tool names. Agents use Git through Bash; Agent Browser contributes optional prompt guidance.

Risks include read, workspace write, command, network, secret, destructive, agent spawn, deployment, and interaction. Read [tools and policy](/developers/tools-policy/) before treating a risk label as a security boundary.
