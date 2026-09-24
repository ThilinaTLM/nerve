---
title: Edit files, inspect context, and keep notes
description: Review and edit project files, monitor agents and context, and keep project scratch notes.
sidebar:
  order: 8
---

## File viewing and editing

Open files from the Files panel, tool cards, project references, Git changes, or pull request files. Nerve displays text, images, and Markdown, can target a line, toggle wrapping, highlight selection matches, and switch Markdown or Mermaid render modes.

Small regular text files inside the project are directly editable. Type in the text view and save with `Ctrl/Cmd+S`. A modified indicator remains until the draft is saved, and closing one or more modified file tabs asks whether to save, discard, or cancel. Saving is atomic and revision-checked: if another program changed the file after Nerve loaded it, Nerve preserves your draft and reports a conflict instead of overwriting the newer content.

Editing is unavailable for files outside the project, symbolic links, binary files, and text files larger than 1 MiB. Large files are bounded and show truncation state; unsupported binary content cannot be rendered. Use an external editor or approved agent tools when the built-in editor is not suitable.

## Context and active agents

The Context panel explains loaded resources and conversation context. Its Agents section groups the lead, persistent developer teammates, and temporary Explore agents, with live status and access to child transcripts. See [Agents and delegation](/guides/agents-and-delegation/) for the difference between them.

The composer meter shows current usage as a fraction of the model's declared context window when usage information is available. It can display `?` before the provider reports enough information. Automatic compaction creates an explicit transcript event. The full stored history graph remains available even when the active model context contains a summary.

## Notes

Notes are project-scoped scratch records in Nerve state. Create and delete them from the Notes dock panel. They are useful for temporary observations that should not become repository instructions or source files.

For durable agent guidance, use `AGENTS.md`, `SYSTEM.md`, or a skill in the documented resource locations. Notes are not automatically loaded as agent instructions.

## Next steps

- [Agents and delegation](/guides/agents-and-delegation/)
- [Skills and resources](/guides/skills-and-resources/)
- [Storage and migration](/operations/storage-migration/)
