---
title: Agent tool catalog
description: The 50 agent-callable tools, availability gates, risks, and important limits.
sidebar:
  order: 3
---

Nerve exposes 50 tool names. Availability also depends on mode, permission, runtime discovery, module settings, and user toggles.

## Files and execution

- Inspection: `read`, `grep`, `find`, `ls`
- Editing: `edit`, `write`
- Execution: `bash`, `python_exec`

Reads are bounded and parallel-capable. `edit`/`write` are serialized mutations. Bash is finite/noninteractive and process-tree cancellable. Python accepts exactly one code/file source, has no stdin, and is capped at 600 seconds.

## Web and Atlassian

- Web: `web_search`, `web_fetch`
- Jira reads: `jira_search_users`, `jira_search_issues`, `jira_get_issue`, `jira_get_project`, `jira_search_boards`, `jira_get_board`, `jira_get_sprint`, `jira_download_attachment`
- Jira writes: `jira_create_issue`, `jira_update_issue`, `jira_transition_issue`, `jira_manage_comment`, `jira_manage_worklog`, `jira_manage_issue_link`, `jira_manage_attachment`, `jira_manage_sprint`, `jira_manage_backlog`
- Confluence reads: `confluence_search_spaces`, `confluence_search_pages`, `confluence_get_page`, `confluence_download_page`
- Confluence writes: `confluence_create_page`, `confluence_update_page`, `confluence_manage_comment`, `confluence_manage_page`, `confluence_manage_label`, `confluence_manage_restriction`, `confluence_manage_attachment`

Web search/fetch, image explanation, and Python are individual global tool toggles. Search requires Tavily. Jira/Confluence require enabled modules and credentials.

## Image explanation

- `explain_image`

Choose an image-capable fallback model and its thinking level under **Settings → Tools**, then explicitly enable the tool. It is exposed only when the current agent model is text-only. When disabled, it is absent from the agent's tool schema and system prompt.

The tool accepts an absolute or project-relative JPEG, PNG, GIF, or WebP path and an optional focus prompt. It sends the image to the configured vision model and returns only bounded explanatory text to the primary model. Cloud providers receive the image bytes; a compatible local provider can keep processing local.

## Interaction and to-dos

- `ask_user`
- `todos_set`, `todos_get`

Questions suspend a run. To-dos are structured current-work state, not background processes.

## Background tasks

- `task_start`, `task_status`, `task_logs`, `task_control`

Task start supports readiness URL/pattern, encrypted-at-rest env values, and runtime up to 24 hours. Its result also reports other active tasks in the workspace scope. Use `task_control` with `action: "stop"` or `action: "restart"` for one selected task. Status/log tools are bounded and agents receive asynchronous updates rather than polling.

## Explore and planning

- `explore`
- `plan_mode_enter`, `plan_mode_present`, `plan_mode_force_exit`

Explore accepts 1–8 child tasks, with 8 active and 24 total launches per parent run. Children are isolated/read-only and receive only `read`, `grep`, `find`, `ls`, `task_status`, and `task_logs`.

## Not agent tools

Workbench Git/GitHub routes and Agent Browser skill discovery are not tool names. Agents use Git through Bash; Agent Browser contributes optional prompt guidance.

Risks include read, workspace write, command, network, secret, destructive, agent spawn, deployment, and interaction. Read [tools and policy](/developers/tools-policy/) before treating a risk label as a security boundary.
