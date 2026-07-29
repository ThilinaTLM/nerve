---
title: Inspect files, context, and notes
description: Preview project files, understand active context, and keep project scratch notes.
sidebar:
  order: 8
---

## File previews

Open files from tool cards, project references, Git changes, or pull request files. Nerve previews text, images, and Markdown, can target a line, toggle wrapping, and switch Markdown render mode. Large files are bounded and show truncation state; unsupported binary content cannot be rendered.

The preview pane is not an editor. Make code changes through agent tools or your external editor.

## Context

The Context panel explains loaded resources and conversation context. The composer meter shows current usage as a fraction of the model's declared context window when usage information is available. It can display `?` before the provider reports enough information.

Automatic compaction creates an explicit transcript event. The full stored history graph remains available even when the active model context contains a summary.

## Notes

Notes are project-scoped scratch records in Nerve state. Create and delete them from the Notes dock panel. They are useful for temporary observations that should not become repository instructions or source files.

For durable agent guidance, use `AGENTS.md`, `SYSTEM.md`, or a skill in the documented resource locations. Notes are not automatically loaded as agent instructions.

## Next steps

- [Skills and resources](/guides/skills-and-resources/)
- [Storage and migration](/operations/storage-migration/)
