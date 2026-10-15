---
title: Organize conversations
description: Create, search, open, and manage project conversations.
sidebar:
  order: 6
---

Conversations belong to a project and persist under `NERVE_HOME`. The navigator shows recent conversations, open/activity state, and bounded lists with **See more** for larger histories. Activity is a server-derived snapshot: running, waiting for you, waiting for background work, error, stopped, idle, or completed. Coding and planning are modes that change presentation and policy, not lifecycle states.

## Create and find

Create a conversation from the project navigator or a new-conversation shortcut. Conversation search opens a modal for the selected project's rows; it is separate from recent-project and directory search in the project picker.

Open conversations become center tabs. Hidden conversation tabs stay mounted, allowing live streaming state and scroll position to remain stable while you inspect another tab.

## Read the transcript

The virtualized transcript can show:

- user and assistant messages;
- provider-returned thinking;
- tool calls, live output, and artifacts;
- approvals, questions, and plans;
- queued prompts and background-work notices;
- compaction and branch summaries;
- retry, interruption, failure, and continuation states.

Thinking is only visible when a provider returns it. Nerve does not reconstruct private reasoning a provider withholds. Transcript entries are durable history and model context; the current activity indicator is a rebuildable projection rather than another transcript state machine.

## Follow concurrent work

The activity island above the composer brings **Agents**, **Commands**, return-to-lead navigation, and the jump to the latest output into one place. Agents open child conversations; commands open async Bash output tabs. Saved servers and watchers are managed separately in **Launches**. See [delegation](/guides/agents-and-delegation/#follow-progress) and [launch configurations](/guides/background-tasks/).

## Delete carefully

Removing a project first removes its Nerve conversations and associated state; it does not mean “delete the source directory.” Conversation pruning protects conversations with active runs, pending human input, or awaited asynchronous work, and can remove related inactive records and managed files.

## Next steps

- [History, branches, and recovery](/guides/history-and-recovery/)
- [Backups and external editors](/guides/import-export-editors/)
