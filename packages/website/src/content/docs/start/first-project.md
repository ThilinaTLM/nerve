---
title: Open your first project
description: Select a directory, create a conversation, and send a supervised prompt.
sidebar:
  order: 4
---

A Nerve project points to a local directory. The project record and conversation history live in `NERVE_HOME`; the code remains in the directory you select.

## Select a directory

1. Open the project picker.
2. Browse from your home directory, choose a recent location, or type a path.
3. Select the repository or workspace root.
4. Create a conversation.

The picker highlights common project signals such as Git, package workspaces, Python, Rust, and Go. Hidden directories are omitted from normal browsing. Nerve resolves absolute and symbolic paths where possible and reuses an existing project record for the same canonical directory.

Selecting a directory gives enabled agent tools direct access to that workspace according to the current permission level. Nerve does not require the directory to contain Git, but a clean Git working tree makes review and recovery easier.

## Start supervised

Choose:

- **Coding** mode;
- **Supervised** permission;
- your authenticated model and supported thinking level.

Send an inspection-first prompt such as:

> Inspect this project and explain its architecture. Do not modify files.

You will see text and any thinking returned by the provider, plus cards for file reads, search, and other tool calls. If autoapproval for reads is off, approve each read card. Non-read tools remain gated in supervised mode.

## Navigate the workbench

- Conversations and Tasks start in the left dock.
- Git, Pull Requests, Context, and Notes start in the right dock.
- Conversations, file previews, task logs, PR details, settings, auth, and logs open as center tabs.
- Panels can move, hide, and resize; layout is stored in browser local storage.

:::tip
Below 1024px, dock views become left and right sheets. The phone-density layout begins below 640px, but the same project and conversation data remains available.
:::

## Use the built-in guide

After opening a project, choose **Help → Guides → Work through the Workbench** for an interactive tour. The catalog also includes provider, voice, model, agent-default, and web-search setup coaches.

## Next steps

- [Complete a safe first task](/start/first-task/)
- [Use the built-in Guides](/start/guides/)
- [Learn the workbench](/guides/workbench/)
- [Configure Settings](/guides/settings/)
- [Learn the composer](/guides/composer/)
