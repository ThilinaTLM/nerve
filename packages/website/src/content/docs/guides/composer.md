---
title: Use the composer
description: Send, stop, steer, complete commands and project paths, and monitor context.
sidebar:
  order: 2
---

The composer keeps the prompt and a single bottom toolbar in one card. Use the toolbar for model, thinking, profile, permissions, capabilities, context, voice, and send/stop controls. Suggestions sit above the editor; delegated agents and background commands stay in the separate activity island.

## Send and stop

`Enter` and `Ctrl/Cmd+Enter` submit unless a completion menu is open. A new idle conversation starts a run. During an active turn, a normal prompt becomes a steering message and appears as a queued row in the transcript.

A queued prompt can be discarded, **Cancel & Edit**-ed back into the composer, or **Force Push**-ed. Force Push interrupts the current provider request or foreground tool, then flushes every queued prompt immediately in FIFO order without cancelling the overall run. Inline command prompts cannot queue. Stop targets the exact active run; Nerve suppresses duplicate stops and reconciles late completion events.

## Completions

Type `/` to filter available inline commands. Type `@` to search project references in a grouped menu: files and directories, pull requests, issues, skills, tools, agents/profiles, and launches. Available results depend on the project, conversation, and configured integrations.

Narrow a search with prefixes such as `@file:composer`, `@pr:123`, `@issue:bug`, `@skill:review`, `@tool:grep`, `@agent:`, or `@launch:dev`. Use arrow keys to navigate and Enter to select. References insert the relevant path or context; capability selections can enable a tool, skill, or profile for the conversation, but never bypass trust or permission checks.

Remote sources can show loading, stale, or unavailable status without blocking local results. The same reference completion is available when answering an agent's question.

## Drop files and folders

In the desktop app, drag one or more files or folders onto the composer. The drop target inserts their paths at the current selection. Items inside the active project use project-relative paths, the project root becomes `.`, and items outside the project keep absolute paths. Multiple paths preserve their order, and paths containing whitespace are quoted.

Dropped paths remain editable and are sent only when you submit the prompt. Nerve does not copy or upload the items, create thumbnails, or store durable attachments; it mentions their existing filesystem locations so the agent can work with them under its normal tool and permission limits.

This workflow requires Electron's native path bridge and is not available in a normal browser or installed PWA. Use `@` completion there to reference paths inside the current project.

## Suggestions

Contextual prompt chips appear above the editor. Selecting one inserts or sends reusable content, depending on the suggestion. Built-ins cover common Git follow-ups; user and project definitions can add more.

## Capabilities

The compact **Capabilities** control has three tabs: **Tools**, **Skills**, and **Sub-agents**. Tools and Skills let you toggle items without changing user or project defaults. A dot marks conversations with explicit capability overrides; the header reset removes tool, skill, and delegation overrides and resumes inheritance, without resetting profile fields. The Settings button opens the settings page for the selected tab.

In a lead conversation, **Sub-agents** has a **Delegation** switch and one row per profile, with an on/off switch and a short summary. A dot marks profiles changed in this conversation. Turning Delegation off removes the delegation tools; profile switches cannot turn it back on. Open a profile's row to change its model and thinking for this conversation. A value changed here shows **This conversation · Revert**. Changes apply only to sub-agents created afterwards. Existing children keep their configuration; open a child and use its own model and thinking controls to change it. Draft lead conversations support profile overrides before the first message; children do not expose editable delegation profiles.

Tools with settings show a configure button that opens the same dialog as **Settings → Tools**, scoped to the conversation: the Jira, Confluence, or Tavily profile; the Image explanation model; Image generation model and output defaults; and the Kroki server for diagram export. A conversation's tool settings replace that tool's inherited settings as a whole, and saving values equal to the inherited ones removes the override.

The selection order is User defaults → trusted Project overrides → Conversation overrides. This includes the opt-in state of Built-in Nerve skills. Permissions, Planning permission limits, credentials, provider support, and local runtime availability are applied afterward, so selecting a capability does not grant authority or guarantee availability. Capability changes made during a run are resolved for the next provider request, not the request already streaming. Disabling a skill cannot remove instructions already present in conversation history.

## Context, agents, and to-dos

The toolbar displays current context-window pressure and cumulative usage when the provider reports it. A context value can remain unknown until a response. Select the context indicator to open the context popover with usage and compaction; its header buttons give session details, the compaction profile, and custom instructions; use **Agents** in the activity island above the composer to monitor sub-agents or open one, and **Commands** to inspect async Bash output. The to-do indicator reflects structured agent work state; it is separate from delegated agents and supervised background processes.

## Review gates

A pending approval, question, or plan review disables normal composition. Resolve the card in the transcript. This keeps the decision associated with the exact tool or plan that requested it.

:::note
Dropped items are path mentions, not uploads or attachments. Clipboard image paste is separate: it creates temporary local image paths for image-capable models.
:::

## Next steps

- [Images and voice](/guides/images-and-voice/)
- [Agent controls](/guides/agent-controls/)
- [Agents and delegation](/guides/agents-and-delegation/)
- [Prompt suggestions](/guides/prompt-suggestions/)
