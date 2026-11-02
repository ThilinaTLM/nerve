---
title: Find and organize conversations
description: Search, group, pin, and title your conversations, and follow the work happening in them.
sidebar:
  order: 6
---

Conversations belong to a project and are saved on your computer. Use the Conversations panel to start new ones and get back to old ones.

## Start and open a conversation

Create a conversation from the Conversations panel, or with `Mod+N`. `Mod+Shift+N` starts one from a project of your choice. An open conversation becomes a tab, and a hidden tab keeps streaming, so you can look at something else meanwhile.

## Find a conversation

The list is grouped so the urgent ones come first: **Needs you**, **Pinned**, **Today**, **Yesterday**, **Previous 7 days**, and **Older**. A colored rail on each row shows its status: running, waiting for you, waiting for background work, failed, stopped, or done.

- Search the list with `Mod+K`. It searches the selected project's conversations.
- Right-click a conversation (or its tab) to **Pin** it so it stays near the top.
- Choose **Mark done** to move a finished conversation out of the way, and **Reopen** to bring it back.

## Get better titles

Every new conversation gets an instant title taken from your first prompt. To have a model write a better one in the background, turn on **Improve titles with AI** in **Settings → Titles**. It's off by default and only affects new conversations. A title you set yourself is never replaced.

AI titles send a shortened version of your first prompt to the model you choose there, which may bill for usage. Pick a small, fast model.

## Link conversations to GitHub

When you mention a GitHub pull request or issue in a conversation, Nerve links them. The pull request's details show the conversations linked to it. See [Pull requests](/guides/pull-requests/).

## Read the transcript

The transcript shows your messages, the agent's replies and any thinking the provider returns, tool calls with their output, approvals, questions, plans, queued prompts, and notes about compaction, retries, and interruptions. Nerve shows only the thinking a provider returns. Select text in a reply to [quote it](/guides/composer/#quote-a-reply).

## Follow work in progress

The island above the composer collects **Agents** and **Commands**. Agents open sub-agent conversations, and commands open their live output. Saved servers and watchers live in **Launches** instead. See [Sub-agents](/guides/agents-and-delegation/) and [Launches](/guides/background-tasks/).

## Good to know

- Removing a project from Nerve removes its conversations from Nerve, not the project folder.
- Pruning old conversations skips ones that are running, waiting for you, or waiting on background work.
- To hear about conversations without watching the list, see [Notifications and activity](/guides/notifications/).

## Next steps

- [History, branches, and recovery](/guides/history-and-recovery/)
- [Notifications and activity](/guides/notifications/)
- [Back up, move, and upgrade data](/operations/storage-migration/)
