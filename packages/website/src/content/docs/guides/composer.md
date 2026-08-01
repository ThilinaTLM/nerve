---
title: Use the composer
description: Send, stop, steer, complete commands and project paths, and monitor context.
sidebar:
  order: 2
---

The composer is the main control surface for a conversation. It combines a Markdown-oriented editor with run controls, model/mode/permission selectors, context usage, to-dos, suggestions, file and folder path mentions, clipboard images, and voice.

## Send and stop

`Enter` and `Ctrl/Cmd+Enter` submit unless a completion menu is open. A new idle conversation starts a run. During an active turn, a normal prompt becomes a steering message and appears as a queued row in the transcript.

A queued prompt can be discarded or **Cancel & Edit**-ed back into the composer. Inline command prompts cannot queue. Stop targets the exact active run; Nerve suppresses duplicate stops and reconciles late completion events.

## Completions

Type `/` to filter available inline commands. Type `@` to search files and directories in the current project. At most 80 completion options are shown.

`@` is project path completion—not a mention system for people, agents, or conversations.

## Drop files and folders

In the desktop app, drag one or more files or folders onto the composer. The drop target inserts their paths at the current selection. Items inside the active project use project-relative paths, the project root becomes `.`, and items outside the project keep absolute paths. Multiple paths preserve their order, and paths containing whitespace are quoted.

Dropped paths remain editable and are sent only when you submit the prompt. Nerve does not copy or upload the items, create thumbnails, or store durable attachments; it mentions their existing filesystem locations so the agent can work with them under its normal tool and permission limits.

This workflow requires Electron's native path bridge and is not available in a normal browser or installed PWA. Use `@` completion there to reference paths inside the current project.

## Suggestions

Contextual prompt chips appear above the editor. Selecting one inserts or sends reusable content, depending on the suggestion. Built-ins cover common Git follow-ups; user and project definitions can add more.

## Context and to-dos

The toolbar displays current context-window pressure and cumulative usage when the provider reports it. A context value can remain unknown until a response. The to-do indicator reflects structured agent work state; it is separate from supervised background processes.

## Review gates

A pending approval, question, or plan review disables normal composition. Resolve the card in the transcript. This keeps the decision associated with the exact tool or plan that requested it.

:::note
Dropped items are path mentions, not uploads or attachments. Clipboard image paste is separate: it creates temporary local image paths for image-capable models.
:::

## Next steps

- [Images and voice](/guides/images-and-voice/)
- [Agent controls](/guides/agent-controls/)
- [Prompt suggestions](/guides/prompt-suggestions/)
