---
title: Files, context, and notes
description: Read and edit project files, check what's in the model's context, and keep scratch notes.
sidebar:
  order: 9
---

Open files from the Files panel, a tool card, an `@` reference, Git changes, or a pull request. Use context and notes to keep a long task on track.

## View and edit files

Nerve shows text, images, and Markdown. You can jump to a line, wrap long lines, and switch Markdown and Mermaid diagrams between rendered and source views.

Small text files inside the project can be edited in place. Type your change and save with `Mod+S`. A marker shows unsaved edits, and closing a modified tab asks whether to save or discard. If another program changed the file after you opened it, Nerve keeps your draft and reports a conflict instead of overwriting the newer version.

For larger changes or a full IDE, open the project in an [external editor](/integrations/external-editors/).

## Check the context

The context popover beside the composer shows how full the model's context is and the conversation's token totals. Select the context indicator to open it. From the popover you can:

- compact the conversation;
- choose the conversation's compaction preset (Aggressive, Balanced, or Conservative);
- copy the session details, such as the project, folder, and conversation ID;
- read or edit the conversation's custom instructions.

The meter can show `?` before the provider has reported usage. See [History, branches, and recovery](/guides/history-and-recovery/) for how compaction works.

## Keep scratch notes

**Scratch Notes** is a panel of notes for the current project. Create and delete notes there for observations that shouldn't become repository files. Agents don't read notes automatically. For lasting guidance, use `AGENTS.md`, `SYSTEM.md`, or a [skill](/guides/skills-and-resources/).

## Good to know

- You can't edit files outside the project, symbolic links, binary files, or text files over 1 MiB.
- Large files may be shortened in the viewer, with a note when they are.

## Next steps

- [Sub-agents](/guides/agents-and-delegation/)
- [Skills and project resources](/guides/skills-and-resources/)
- [Git changes](/guides/git/)
