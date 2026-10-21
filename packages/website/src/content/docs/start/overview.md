---
title: What is Nerve?
description: Understand Nerve's workbench, local daemon, projects, and control model.
sidebar:
  order: 1
---

Nerve is an open-source desktop coding harness for people who want an agent's work to stay visible and controllable. It combines a focused agent runtime with a workbench for conversations, editable project files, context, Git, pull requests, profile-based sub-agents, launch configurations, asynchronous Bash, logs, settings, and project notes.

Nerve is **not a code editor** and does not replace your repository or IDE. It works directly with a directory you select, previews files in the workbench, and can open a project in VS Code or Zed.

## The local-first shape

By default, the Electron app starts and supervises a daemon on `127.0.0.1:3747`, then loads the bundled browser workbench. Nerve state lives under `~/.nerve`; your source code remains in your project directory. The Electron browser profile stays in the operating system's normal Electron profile location, outside `NERVE_HOME`.

The daemon reaches external services only when required by your selected model, a Git remote, or an integration or network tool you enable and invoke. Local-first does not mean offline-only.

## The main concepts

- **Project:** a Nerve record pointing to a local directory. Selecting another project is a workbench action; there is no server-wide current project.
- **Conversation:** persisted agent history associated with a project. Conversations can branch when you navigate to an earlier entry.
- **Agent:** a model-driven worker with a thinking level, profile, permission level, tools, and loaded resources. Each conversation has a lead; it can delegate to sub-agents, each created from a profile such as Explore (read-only research) or Developer.
- **Execution:** a period of model-driven work in a conversation. It can stream output, pause for review, retry, or be interrupted; stored messages and tool results remain available afterward.
- **Launch configuration:** a saved command, working directory, optional port, and run policy for a server or watcher. Each start creates a separately inspectable launch run.
- **Async Bash:** a conversation-owned command that returns immediately or moves to the background after a configured wait. It reports completion without polling.
- **Profile:** instructions and settings for a lead or a creation-time template for a sub-agent. Sub-agent profile edits do not reconfigure existing children.

## Why the controls matter

Choose a Coding or Planning profile and one of three authority levels:

- **Read-only** allows local inspection and interaction, and explicitly permits enabled sub-agent prompting and stopping. A child's profile determines its own authority; disable autonomous profiles for inspection-only delegation.
- **Supervised** automatically allows safe reads and asks before other actions unless a matching permission rule allows the action.
- **Autonomous** runs allowed actions without approval, while explicit block exceptions still apply.

These controls are enforced by Nerve's tool policy, but they are not an operating-system sandbox. Review commands and integrations according to the trust you place in the model and project.

:::caution[Beta software]
Nerve can modify files, execute commands, use credentials, and contact networks. Start with a clean Git working tree and supervised permission. Do not expose the daemon to an untrusted network.
:::

## Next steps

- [Follow the guided quickstart](/start/)
- [Install Nerve](/start/install/)
- [Connect a model provider](/start/providers/)
- [Learn the everyday workflow](/guides/)
- [Understand the security boundary](/operations/security/)
