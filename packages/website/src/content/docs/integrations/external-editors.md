---
title: External editors
description: Open a Nerve project in Visual Studio Code or Zed.
sidebar:
  order: 6
---

Nerve discovers and launches Visual Studio Code and Zed. Discovery uses PATH, operating-system application integration, and selected known installation locations.

Use the project action to open the current directory. Editor startup is separate from the agent and does not pass through tool approval policy; it is a direct user-initiated Workbench action.

If an editor is not shown, confirm its CLI or application is installed in a standard location and restart Nerve. Other editor families are not currently exposed by the server project-editor service.

Nerve's file tabs remain preview-only. Edit in your external editor or use approved agent `edit`/`write` tools.

## Next steps

- [Files, context, and notes](/guides/files-context-notes/)
- [Platform troubleshooting](/troubleshooting/platform/)
