---
title: Work with agents and delegation
description: Monitor the lead agent, delegate implementation to persistent teammates, and use Explore for bounded research.
sidebar:
  order: 11
---

A conversation has one **lead agent**. The lead can delegate in two different ways: persistent developer **teammates** for autonomous coding work, or temporary **Explore agents** for bounded read-only research. Both appear with the lead in the Context panel, but their authority and lifecycle differ.

## Monitor agents in Context

Open the **Context** panel to see agents grouped by role:

- **Lead** is the agent you direct through the main composer.
- **Teammates** are persistent developer subagents created by the lead.
- **Explore** contains live research agents and a folded history of completed research.

Status indicators show which agents are working, idle, waiting for you, or in error. Select a child-agent row to open its transcript. The detail action shows its model, mode, permission, run status, and other execution metadata.

## Delegate to a teammate

Async Subagents are disabled by default. Enable the **Async Subagents** tool group under **Settings → Tools → Core** or for the current conversation through the composer's tools-and-skills control.

Once enabled, the lead can:

1. create a named, idle teammate;
2. send an assignment to that teammate;
3. continue its own work while the teammate runs;
4. receive a durable completion notice; and
5. send a follow-up assignment after the teammate becomes idle.

A teammate keeps its own conversation context between assignments and shares the lead's project directory and worktree. It does **not** automatically see the lead's transcript or discoveries, so a good assignment includes relevant findings, file paths, constraints, and the expected outcome. Give teammates non-overlapping ownership: simultaneous edits to the same files can conflict.

Teammates run in Coding mode with Autonomous permission. Creating or assigning one is still checked as agent-spawn authority for the lead. At most four teammates can have active assignments for one lead at a time. An assignment sent to a running or stopping teammate is rejected rather than queued.

When a teammate finishes, Nerve records the result and wakes the lead when appropriate. The teammate remains available for follow-up work. Stopping a teammate cancels its current assignment without deleting its retained history. A new user prompt can reopen a team that was stopped with its lead run.

## Configure teammate runs

Open **Settings → Tools → Core → Async Subagents → Configure** to choose:

- whether new teammates inherit the lead model or use a dedicated model;
- the teammate thinking level; and
- an inherited, built-in, or custom compaction profile.

Model and thinking changes apply when a new teammate is created. The global or project automatic-compaction switch still controls whether teammate compaction runs.

## Use Explore for research

Use **Explore** when the work can be split into independent, read-only codebase questions. Explore children receive only bounded inspection and task-log tools. They cannot edit files, start nested agents, or continue as persistent teammates. One Explore call can launch 1–8 children, subject to the runtime's active and per-run limits, and returns their reports to the lead.

Explore is a better fit for parallel inventory, tracing several independent subsystems, or comparing tests and implementation. A teammate is a better fit when a child needs to implement, validate, and retain context for later follow-ups.

| Choose              | When you need                                        | Authority                                                              | Lifecycle                                             |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| **Teammate**        | Autonomous implementation or repeated follow-up work | Shared worktree and enabled developer tools, within hard policy limits | Persistent and reusable while idle                    |
| **Explore**         | Parallel, bounded codebase research                  | Read-only inspection and task-log access                               | Temporary; reports back after one research assignment |
| **Background task** | A server, watcher, or other long-running process     | Process supervision, not model reasoning                               | Durable task definition with separately retained runs |

## Related pages

- [Control the lead agent](/guides/agent-controls/)
- [Run background tasks](/guides/background-tasks/)
- [Configure Settings](/guides/settings/)
- [Agent tool catalog](/reference/tools/)
