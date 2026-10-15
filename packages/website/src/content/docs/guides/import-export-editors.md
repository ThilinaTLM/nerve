---
title: Back up history and open editors
description: Preserve conversation state and launch supported external editors.
sidebar:
  order: 14
---

## Preserve conversation history

The current workbench does not expose conversation bundle import or JSON/Markdown/HTML export. Older instructions for `nerve.conversation.v1` are not a supported workflow in this version.

To preserve history, stop every Nerve process using the home and back up the complete `NERVE_HOME`, including configuration, encrypted credentials, database sidecars, and referenced managed files. Back up project directories separately: a home backup does not contain your source tree or project-resident `.nerve` configuration. See [storage and migration](/operations/storage-migration/).

Conversation state and tool output can contain prompts, source, paths, commands, and provider details. Do not share a complete home or its secret files as a diagnostic attachment.

## Open an external editor or terminal

Nerve discovers and launches **Visual Studio Code** and **Zed** through PATH, operating-system application integration, and known locations. Project context menus target the project root; Files panel context menus can target an individual file or folder. Project roots and folders can also be opened in a supported host terminal. Other editors are not currently exposed.

The workbench can edit small regular text files inside the project. Use an external editor or approved agent file tools for larger changes, unsupported files, or full IDE workflows. See [Files, context, and notes](/guides/files-context-notes/) for built-in editor limits and save-conflict behavior.

## Project removal and pruning

Removing a Nerve project cascades its Nerve conversations and associated records; it does not delete the project directory. Pruning can remove old inactive conversations by age/count while protecting active or awaiting work.

## Next steps

- [Storage and migration](/operations/storage-migration/)
- [Data formats and locations](/reference/data-formats/)
