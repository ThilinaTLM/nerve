---
title: Organize conversations
description: Create, search, open, and manage project conversations.
sidebar:
  order: 6
---

Conversations belong to a project and persist under `NERVE_HOME`. The navigator shows recent conversations, open/activity state, and bounded lists with **See more** for larger histories.

## Create and find

Create a conversation from the project navigator or a new-conversation shortcut. Conversation search opens a modal for the selected project's rows; it is separate from recent-project and directory search in the project picker.

Open conversations become center tabs. Hidden conversation tabs stay mounted, allowing live streaming state and scroll position to remain stable while you inspect another tab.

## Read the transcript

The virtualized transcript can show:

- user and assistant messages;
- provider-returned thinking;
- tool calls, live output, and artifacts;
- approvals, questions, and plans;
- queued prompts and task events;
- compaction and branch summaries;
- retry, interruption, failure, and continuation states.

Thinking is only visible when a provider returns it. Nerve does not reconstruct private reasoning a provider withholds.

## Delete carefully

Removing a project first removes its Nerve conversations and associated state; it does not mean “delete the source directory.” Conversation pruning protects conversations with running/awaiting agents or active tasks and can remove related inactive task/tool/log/index records.

## Next steps

- [History, branches, and recovery](/guides/history-and-recovery/)
- [Import, export, and editors](/guides/import-export-editors/)
