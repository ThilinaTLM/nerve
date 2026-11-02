---
title: Sub-agents and delegation
description: Let the lead agent hand research and implementation to sub-agents, follow their progress, and define your own teammate profiles.
sidebar:
  order: 11
---

Turn on delegation so the lead agent can run research and implementation in parallel, then follow and steer the sub-agents it starts.

A conversation has one **lead agent**, the one you talk to in the composer. The lead can delegate to **sub-agents**: separate agents that work asynchronously in the same project folder and report back when they finish. A **profile** decides each sub-agent's model, permissions, tools, skills, and instructions.

## Turn on delegation

Delegation is off by default.

1. Open **Capabilities** beside the composer.
2. Switch on **Delegation** for this conversation.

To change the default for new conversations, use the **Sub-agents** row in **Settings → Tools**.

The lead can only start sub-agents from profiles that are usable as teammates. Manage them in **Settings → Sub-Agents**.

## What the lead does

The lead assigns work to up to ten sub-agents at a time. Each assignment has a name, a profile, and a prompt. The lead then keeps working on independent tasks or ends its turn, and is woken when a sub-agent finishes. Naming an existing sub-agent sends it a follow-up, and a stopped sub-agent resumes.

Two built-in teammate profiles are included:

- **Explore** is read-only. Use it for parallel inventory, tracing separate subsystems, or comparing tests with implementation. It ends with a short report of findings.
- **Developer** works on its own in the shared folder. Use it for implementation with follow-ups. Give developers non-overlapping scopes; simultaneous edits to the same files can conflict.

A sub-agent keeps its own context between assignments but does not see the lead's transcript, so a good assignment spells out findings, paths, constraints, and the expected outcome. Sub-agents never ask you questions, present plans, or start more sub-agents.

For larger efforts, choose the built-in **Lead** profile. Its instructions cover scoping work, delegating, reviewing evidence, and validating. Delegation never grants extra authority or bypasses permissions.

## Follow progress

The activity island at the bottom of the transcript has an **Agents** section listing sub-agents with their state and profile, and a **Commands** section for background commands. Select an agent to open its conversation.

While the lead waits, the activity row names what it is waiting for.

In a sub-agent's view you see the same transcript and controls as the lead. You can't prompt a sub-agent directly, but you can stop it and change its model, thinking level, permission (read-only or autonomous), tools, skills, and instructions. Changes apply from its next turn.

Each time a sub-agent finishes, the lead receives its final response or error. If it is very long, the lead gets the first part and a path to the full text. Stopping a sub-agent from its own view tells the lead; stopping it through the lead, or stopping the lead, does not.

## Write your own teammate profile

1. Open **Settings → Sub-Agents** and choose **New profile**.
2. Pick user scope (all projects) or project scope (shared through the repository).
3. Start blank or copy an existing profile, then set its model, permissions, tools, and skills.
4. Describe when the lead should use it. The lead picks profiles from that description.

Editing an inherited profile creates a complete local copy that replaces the original. Project profiles need your trust before they apply. Sub-agents start from their own profile defaults, not the lead's current model, tools, or skills. Later profile or default changes don't reconfigure sub-agents that already started.

If a sub-agent's model hits a usage limit, open its view and change its model directly. See the [profile format](/reference/agent-profiles/) for details.

## Sub-agent or launch?

| Choose        | When you need                                        | Lifecycle                                         |
| ------------- | ---------------------------------------------------- | ------------------------------------------------- |
| **Sub-agent** | Parallel research, or implementation with follow-ups | Reusable; stays until its conversation is deleted |
| **Launch**    | A server, watcher, or other long-running process     | Saved definition; each run keeps its own output   |

## Related pages

- [Choose a profile, model, and permissions](/guides/agent-controls/)
- [Launches and background commands](/guides/background-tasks/)
- [Settings at a glance](/guides/settings/)
- [Agent tool catalog](/reference/tools/)
- [Agent profile format](/reference/agent-profiles/)
