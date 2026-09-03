---
title: External editors and terminals
description: Open Nerve projects, folders, and files in VS Code, Zed, or a terminal.
sidebar:
  order: 6
---

Nerve discovers and launches Visual Studio Code and Zed. Discovery uses PATH, operating-system application integration, and selected known installation locations.

Use a project context menu to open the project directory in either editor or in a terminal. In the Files panel, right-click empty space to target the project root, a folder to target that folder, or a file to open that file in VS Code or Zed. Terminal actions are intentionally limited to the project root and folders.

Editor and terminal startup is separate from the agent and does not pass through tool approval policy; it is a direct user-initiated Workbench action. Launches occur on the workbench daemon host, where the project files live. When connected to a remote daemon, the application opens on that remote host rather than the device displaying the UI.

Terminal selection is host-specific:

- Linux prefers `xdg-terminal-exec`, then the desktop's `x-terminal-emulator`, followed by common installed terminal launchers.
- Windows opens the system command shell in the configured default terminal host.
- macOS opens the system Terminal application.

Unavailable editors or terminal launchers are omitted from menus. If an expected action is missing, confirm its CLI or application is installed in a standard location and restart Nerve. Other editor families are not currently exposed.

Nerve's file tabs remain preview-only. Edit in your external editor or use approved agent `edit`/`write` tools.

## Next steps

- [Files, context, and notes](/guides/files-context-notes/)
- [Remote daemon behavior](/operations/remote-daemon/)
- [Platform troubleshooting](/troubleshooting/platform/)
