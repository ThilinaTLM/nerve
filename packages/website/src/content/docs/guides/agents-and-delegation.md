---
title: Work with agents and delegation
description: Delegate research and implementation to sub-agents, follow their progress, and define your own profiles.
sidebar:
  order: 11
---

A conversation has one **lead agent**, the agent you direct through the composer. The lead can delegate work to **sub-agents**: separate agents that run asynchronously in the same project worktree and report back when they finish. What a sub-agent is (its model, permission, tools, skills, and instructions) comes from a **profile**.

## Enable sub-agents

Sub-agents are disabled by default. Turn on **Sub-agents** under **Settings → Sub-agents** (user or project scope) or for the current conversation through **Capabilities → Sub-agents** beside the composer. The lead is offered only usable profiles. With none but existing children, it retains prompt follow-ups, status and stop, but cannot create new children; the prompt schema omits `profile`. With neither usable profiles nor existing children, the tools are hidden. Turning the master Sub-agents capability off removes the whole tool group regardless of existing children. Manage profiles under **Settings → Sub-agents**.

## What the lead does

The lead assigns work in batches of up to ten sub-agents. Each assignment has a name, a profile, and a prompt, and a batch can share one block of background context. Then it continues independent work or ends its turn; completion notices wake it. Naming an existing sub-agent sends it a follow-up, and a stopped sub-agent is resumed.

Two profiles ship with Nerve:

- **Explore** is read-only. Use it for parallel inventory, tracing independent subsystems, or comparing tests and implementation. It ends with a short report of findings and evidence.
- **Developer** works autonomously in the shared worktree. Use it for implementation with follow-ups. Give developers non-overlapping scopes: simultaneous edits to the same files can conflict.

A sub-agent keeps its own context between assignments and does **not** see the lead's transcript, so a good assignment includes findings, paths, constraints, and the expected outcome. Sub-agents never ask you questions, use plan mode, or create further sub-agents.

## Follow progress

When a conversation has sub-agents, an **Agents** pill appears at the top right of the transcript. It shows how many are working and how many background commands are running. Open it to see the lead and its sub-agents with state, model, and context usage, and to stop or read the output of background commands. Sub-agents that have been idle for ten minutes fold under an **earlier** row; failed ones stay visible.

While the lead waits for sub-agents or background commands, the activity row at the bottom of the transcript names what it is waiting for.

Select a sub-agent to open it in the main view with the same transcript and controls as the lead. You cannot prompt a sub-agent directly: the composer is covered, with a way back to the lead. You can still stop it, and you can change its model, thinking level, permission (read-only or autonomous), tools, skills, compaction, and instructions from the composer toolbar and the context popover. Changes apply from its next turn, and the lead sees them through `subagent_status`.

## Completion notices

Each time a sub-agent finishes an execution, the lead receives a notice with its final response, or its error. If the response is longer than 16 KB, the notice carries the first part and a path to the full text, saved with the sub-agent's conversation. A sub-agent that ends its turn while background commands are still running is reported as waiting; it finishes again when a command completes.

Stopping a sub-agent from its own view notifies the lead. Stopping it through the lead, or stopping the lead (which stops its sub-agents), does not.

## Write your own profile

The scoped JSON implementation provides a full **Settings → Sub-agents** editor in user and project scope, with enabled state, model, thinking, instructions, permissions, capabilities, compaction, copy-to-scope and reset. Project profiles require trust in the exact document content. In a saved lead conversation, **Capabilities → Sub-agents** provides enabled, model and thinking overrides for newly created children, without changing reusable user/project defaults. Explicit overrides stay pinned until reset. See the [profile format reference](/reference/subagent-profiles/).

Profile changes never reconfigure an existing child. If its model hits usage limits, open that child's view and change its own model and thinking level directly. A follow-up to the same name keeps those changes; it does not reapply the profile.

| Choose              | When you need                                        | Authority                                   | Lifecycle                                               |
| ------------------- | ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| **Sub-agent**       | Parallel research, or implementation with follow-ups | Set by its profile: read-only or autonomous | Reusable; stays until its lead conversation is deleted  |
| **Background task** | A server, watcher, or other long-running process     | Process supervision, not model reasoning    | Durable launch definition with separately retained runs |

## Related pages

- [Control the lead agent](/guides/agent-controls/)
- [Run background tasks](/guides/background-tasks/)
- [Configure Settings](/guides/settings/)
- [Agent tool catalog](/reference/tools/)
- [Sub-agent profile format](/reference/subagent-profiles/)
