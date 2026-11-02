---
title: What is Nerve?
description: A short tour of the Nerve workbench, how it runs on your machine, and how you stay in control.
sidebar:
  order: 1
---

Nerve is a desktop coding workbench where an agent's work stays visible and under your control. You can talk to the agent, review what it does, and handle files, Git, and pull requests in one place.

Nerve is not a code editor and does not replace your IDE. It works in a folder you choose, and you can open that folder in VS Code or Zed.

## Runs on your machine

Nerve keeps your conversations, settings, and credentials on your computer, in `~/.nerve`. Your code stays in your project folder. Nerve sends data out only when your chosen model, a Git remote, or a tool you turned on needs it, so it is local-first but not offline-only. It has no account and sends no analytics.

## The main ideas

- **Project:** a folder you opened in Nerve. Each project keeps its own conversations, launches, Git state, and notes.
- **Conversation:** one thread of work with an agent. You can go back to an earlier point and branch from it.
- **Agent profile:** the role the agent plays. **Coding** makes changes; **Planning** researches and proposes a plan for you to review. You can add your own profiles.
- **Sub-agent:** a teammate the agent can hand work to, such as Explore (read-only research) or Developer.
- **Launch:** a saved command for a server or watcher, with its own status and logs.
- **Background command:** a shell command the agent starts and keeps running while you continue.

## You decide how much the agent can do

Pick a permission level for each conversation:

- **Read-only:** the agent can look around but not change anything.
- **Supervised:** the agent can read freely and asks before running commands, changing files, or using the network.
- **Autonomous:** the agent acts without asking, except where you have blocked something.

These controls are guardrails inside Nerve, not an operating-system sandbox. Review commands and integrations according to how much you trust the model and the project.

:::caution[Beta software]
Nerve can change files, run commands, use credentials, and reach the network. Start with a clean Git working tree and Supervised permission, and don't expose the daemon to an untrusted network.
:::

## Next steps

- [Install Nerve](/start/install/)
- [Connect a model](/start/providers/)
- [Learn the everyday workflow](/guides/)
- [Understand the security model](/operations/security/)
