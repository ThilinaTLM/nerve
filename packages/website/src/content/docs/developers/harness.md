---
title: Harness and agent loop
description: Trace Nerve's model streaming, queues, tools, compaction, resources, and recovery.
sidebar:
  order: 3
---

Nerve's `AgentHarness` is a persisted, evented conversation facade. pi-ai supplies model/provider metadata and streaming primitives; Nerve composes product behavior around them.

## A turn

At each turn, the workbench runtime resolves model/auth, thinking, mode, permission, resources/system prompt, and active tools. The harness snapshots this configuration, calls pi-ai streaming, and converts assistant text/thinking and tool calls into persisted/live artifacts.

Model or thinking updates during a turn become pending configuration and apply to a later provider request.

## Tool execution

The generic loop can run independent tools in parallel. Global configuration or a tool declaration can force sequential execution. Hooks can block a call, patch results, or terminate handling. The server adapter is the authority for tool availability, approval suspension, user input, policy, and persisted lifecycle records.

## Queues

Steering messages inject after a completed model/tool batch; follow-up messages run when work would otherwise end. Queue handling defaults to one-at-a-time, can coalesce consecutive user messages, and supports next-turn content prepending.

## Context

The harness owns generic compaction/summarization. The workbench adds automatic thresholds, continuation caps, durable checkpoints, host retries, restart recovery, and context-overflow recovery that navigates before the failed assistant entry, compacts, and continues.

## Resources and children

The server loads effective AGENTS/SYSTEM/skills according to scope and toggles. Explore creates fresh child agents with isolated transcripts and forced read-only tools, then returns reports to the parent.

## Next steps

- [Tools and policy](/developers/tools-policy/)
- [Resource reference](/reference/resources/)
- [Protocol](/developers/protocol/)

Compaction budgets opaque reasoning without modifying provider signatures. Individual assistant output usage provides a retention floor (reasoning is already part of output); missing usage falls back to an opaque-size heuristic. Post-compaction estimates use the same context reconstruction as execution, not sliced historical checkpoints. Before fresh provider usage, automatic decisions recompute the retained context rather than trust stored historical estimates.

Summary generation uses one bounded request for history and any removed turn prefix, with at most one quality-repair retry. Failure does not silently substitute an extractive checkpoint. Conversation estimates exclude system/tool/provider overhead and cannot guarantee an exact request-token count.
