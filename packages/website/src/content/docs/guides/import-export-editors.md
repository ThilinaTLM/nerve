---
title: Import, export, and open editors
description: Move conversation records and launch supported external editors.
sidebar:
  order: 14
---

## Export a conversation

Nerve can export JSON, Markdown, or HTML. The JSON bundle uses `nerve.conversation.v1` and includes the project, conversation, agents, and all stored entries—not only the active branch. Markdown and escaped HTML are convenient reading formats, not round-trip substitutes for the JSON bundle.

Exports can contain prompts, model output, tool arguments/output, paths, and operational details. Review before sharing.

## Import JSON

Import creates new IDs and remaps parent references. Valid entries from the complete tree are retained. Malformed optional agent or entry records are skipped instead of failing the entire bundle, so inspect the imported history before treating it as complete.

Importing a conversation does not import its original project directory or source files. Associate work with a directory available on the current machine.

## Open an external editor or terminal

Nerve discovers and launches **Visual Studio Code** and **Zed** through PATH, operating-system application integration, and known locations. Project context menus target the project root; Files panel context menus can target an individual file or folder. Project roots and folders can also be opened in a supported host terminal. Other editors are not currently exposed.

The workbench file pane remains a preview. Continue editing in your external editor or through approved agent file tools.

## Project removal and pruning

Removing a Nerve project cascades its Nerve conversations and associated records; it does not delete the project directory. Pruning can remove old inactive conversations by age/count while skipping running/awaiting agents and active tasks.

## Next steps

- [Storage and migration](/operations/storage-migration/)
- [Data formats and locations](/reference/data-formats/)
