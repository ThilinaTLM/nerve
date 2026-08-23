---
title: What is Nerve?
description: Understand Nerve's workbench, local daemon, projects, and control model.
sidebar:
  order: 1
---

Nerve is an open-source desktop coding harness for people who want an agent's work to stay visible and controllable. It combines a focused agent runtime with a workbench for conversations, files, context, Git, pull requests, background tasks, logs, settings, and project notes.

Nerve is **not a code editor** and does not replace your repository or IDE. It works directly with a directory you select, previews files in the workbench, and can open a project in VS Code or Zed.

## The local-first shape

By default, the Electron app starts and supervises a daemon on `127.0.0.1:3747`, then loads the bundled browser workbench. Nerve state lives under `~/.nerve`; your source code remains in your project directory. The Electron browser profile stays in the operating system's normal Electron profile location, outside `NERVE_HOME`.

The daemon reaches external services only when required by your selected model, a Git remote, or an integration or network tool you enable and invoke. Local-first does not mean offline-only.

## The main concepts

- **Project:** a Nerve record pointing to a local directory. Selecting another project is a workbench action; there is no server-wide current project.
- **Conversation:** persisted agent history associated with a project. Conversations can branch when you navigate to an earlier entry.
- **Agent:** the model, thinking level, mode, permission level, tools, and loaded resources used for work.
- **Run:** one durable execution attempt. Runs can stream output, pause for review, retry, or continue from a recoverable checkpoint.
- **Task:** a supervised long-running process such as a server or watcher. Tasks are distinct from finite shell commands and agent to-dos.

## Why the controls matter

Choose coding or planning mode and one of three authority levels:

- **Read-only** blocks mutation, command execution, ordinary network calls, and child-agent spawning.
- **Supervised** automatically allows safe reads and asks before other actions unless an exact-risk allow exception applies.
- **Autonomous** runs allowed actions without approval, while explicit block exceptions still apply.

These controls are enforced by Nerve's tool policy, but they are not an operating-system sandbox. Review commands and integrations according to the trust you place in the model and project.

:::caution[Beta software]
Nerve can modify files, execute commands, use credentials, and contact networks. Start with a clean Git working tree and supervised permission. Do not expose the daemon to an untrusted network.
:::

## Next steps

- [Install Nerve](/start/install/)
- [Connect a model provider](/start/providers/)
- [Understand the security boundary](/operations/security/)
