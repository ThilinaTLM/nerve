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

## Use the Team Lead skill

Optionally enable the built-in **team-lead** skill in **Settings → Skills** for orchestration guidance. Enable **Sub-agents** separately: a skill supplies instructions, not delegation access or extra authority. Team Lead guides the lead to assign scoped, non-overlapping work, review handoffs and changes, and coordinate validation and corrections before reporting completion. Keep the orchestration skill on the lead rather than passing it to implementation children.

## Follow progress

The **activity island** sits at the bottom of the transcript, beside the activity row above the composer. Its **Agents** section lists retained sub-agents with state and profile; **Commands** lists all running async Bash commands and the five most recently settled commands. Select an agent to open its conversation or a command to open its output tab.

Lists fold by count, not age: a six-row budget keeps live work and the viewed agent visible, with older settled rows under **Show older**. Counts show running/total while work is active. In a child view, the island also provides a way back to the lead; when scrolled away from the newest transcript entries, it offers a jump to the latest output.

While the lead waits for sub-agents or background commands, the activity row at the bottom of the transcript names what it is waiting for.

Select a sub-agent to open it in the main view with the same transcript and controls as the lead. You cannot prompt a sub-agent directly: the composer is covered, with a way back to the lead. You can still stop it, and you can change its model, thinking level, permission (read-only or autonomous), tools, skills, compaction, and instructions from the composer toolbar and the context popover. Changes apply from its next turn, and the lead sees them through `subagent_status`.

## Completion notices

Each time a sub-agent finishes an execution, the lead receives a notice with its final response, or its error. If the response is longer than 16 KB, the notice carries the first part and a path to the full text, saved with the sub-agent's conversation. A sub-agent that ends its turn while background commands are still running is reported as waiting; it finishes again when a command completes.

Stopping a sub-agent from its own view notifies the lead. Stopping it through the lead, or stopping the lead (which stops its sub-agents), does not.

## Write your own profile

Choose **New profile** under **Settings → Sub-agents** in user scope (all projects) or project scope (shared through the repository). Start blank or from a copy of an existing profile. New profiles are read-only and use the lead's model, thinking, tools and skills until you change them. Describe when the lead should use the profile, because the lead chooses profiles by their description. To adjust an existing profile for one layer, open it and change only the fields you need; everything else keeps following the lower layer. Project profiles require trust in the exact document content. In a saved lead conversation, **Capabilities → Sub-agents** changes availability, model and thinking for newly created children only. See the [profile format reference](/reference/subagent-profiles/).

Profile changes never reconfigure an existing child. If its model hits usage limits, open that child's view and change its own model and thinking level directly. A follow-up to the same name keeps those changes; it does not reapply the profile.

| Choose                   | When you need                                        | Authority                                   | Lifecycle                                               |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| **Sub-agent**            | Parallel research, or implementation with follow-ups | Set by its profile: read-only or autonomous | Reusable; stays until its lead conversation is deleted  |
| **Launch configuration** | A server, watcher, or other long-running process     | Process supervision, not model reasoning    | Durable launch definition with separately retained runs |

## Related pages

- [Control the lead agent](/guides/agent-controls/)
- [Launch configurations and async Bash](/guides/background-tasks/)
- [Configure Settings](/guides/settings/)
- [Agent tool catalog](/reference/tools/)
- [Sub-agent profile format](/reference/subagent-profiles/)
