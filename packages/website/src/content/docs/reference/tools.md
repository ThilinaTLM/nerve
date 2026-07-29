---
title: Agent tool catalog
description: The 38 agent-callable tools, availability gates, risks, and important limits.
sidebar:
  order: 3
---

Nerve exposes 38 tool names. Availability also depends on mode, permission, runtime discovery, module settings, and user toggles.

## Files and execution

- Inspection: `read`, `grep`, `find`, `ls`
- Editing: `edit`, `write`
- Execution: `bash`, `python_exec`

Reads are bounded and parallel-capable. `edit`/`write` are serialized mutations. Bash is finite/noninteractive and process-tree cancellable. Python accepts exactly one code/file source, has no stdin, and is capped at 600 seconds.

## Web and Atlassian

- Web: `web_search`, `web_fetch`
- Jira: `jira_search_users`, `jira_search_issues`, `jira_get_issue`, `jira_get_project`, `jira_create_issue`, `jira_update_issue`, `jira_add_comment`, `jira_transition_issue`
- Confluence: `confluence_search_spaces`, `confluence_search_pages`, `confluence_get_page`, `confluence_download_pages`, `confluence_create_page`, `confluence_update_page`, `confluence_publish_pages`, `confluence_upload_attachment`

Only Web search/fetch and Python are individual global tool toggles. Search requires Tavily. Jira/Confluence require enabled modules and credentials.

## Interaction and to-dos

- `ask_user`
- `todos_set`, `todos_get`

Questions suspend a run. To-dos are structured current-work state, not background processes.

## Background tasks

- `task_start`, `task_status`, `task_logs`, `task_cancel`, `task_restart`

Task start supports readiness URL/pattern, encrypted-at-rest env values, and runtime up to 24 hours. Status/log tools are bounded and agents receive asynchronous updates rather than polling.

## Explore and planning

- `explore`
- `plan_mode_enter`, `plan_mode_present`, `plan_mode_force_exit`

Explore accepts 1–8 child tasks, with 8 active and 24 total launches per parent run. Children are isolated/read-only and receive only `read`, `grep`, `find`, `ls`, `task_status`, and `task_logs`.

## Not agent tools

Workbench Git/GitHub routes and Agent Browser skill discovery are not tool names. Agents use Git through Bash; Agent Browser contributes optional prompt guidance.

Risks include read, workspace write, command, network, secret, destructive, agent spawn, deployment, and interaction. Read [tools and policy](/developers/tools-policy/) before treating a risk label as a security boundary.
