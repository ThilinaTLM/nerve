---
title: Harness and conversation runtime
description: Trace model streaming, durable inputs, tools, asynchronous delegation, and recovery.
sidebar:
  order: 3
---

Nerve separates the generic agent loop from the durable conversation runtime. `@nervekit/harness` supplies model/provider resolution, streaming, context and compaction primitives. `@nervekit/conversation-core` owns conversation history, queued inputs, tool-call lifecycle, execution scheduling, delegation and async Bash. The workbench server supplies environment ports for resources, permissions, profiles, model access and local execution.

## A turn

Core resolves turn resources through host ports and calls the harness. Assistant text, thinking, argument drafts and progress stream as ephemeral updates; completed messages become durable conversation events. Configuration changes take effect at subsequent turn/provider-request boundaries rather than rewriting an in-flight request.

Tool calls from a persisted assistant message become unfinished `TOOL_CALL` rows. Supervision, approval, execution and user-input suspension belong to core. Settlement appends a `tool_call_response` event and deletes the unfinished row transactionally. Independent calls can progress separately; the next model request waits for the turn's unfinished calls to settle.

## Inputs and control

`INPUT_QUEUE` contains undelivered input, not a second transcript. Delivery appends conversation facts and removes the queued rows transactionally. User prompts, sub-agent completion notices and background-command notices use this boundary.

Pause prevents automatic wakes without aborting current work. Stop pauses the conversation and cancels its current work, descendants and background commands. A new user prompt resumes its receiving conversation; system notices do not. Force push interrupts only the current conversation turn, clears pause and drains eligible inputs without the stop cascade.

## Context and compaction

Selected-head history drives both transcript and model context; replay covers all branches in event-sequence order. Core reconstructs model context from those facts using harness primitives. Compaction fields resolve through user/project/conversation `config/agent.json` preferences and the applied profile contribution. Children use captured underlying preferences and requirements; reset removes an editable override and inherits. Compaction summaries are history events, not a separate checkpoint store.

Context usage is an estimate, not a guarantee of an exact provider request-token count. Provider overhead and opaque reasoning can make local estimates differ from billed usage.

## Asynchronous sub-agents

`subagent_prompt` submits a validated batch of named assignments and returns without waiting for child completion. New names create ordinary child conversations from resolved profiles; existing names receive follow-ups using their current child configuration. `subagent_status` inspects them and `subagent_stop` stops their work without deleting them. Completion notices wake the lead, so polling is unnecessary.

Profiles are complete per-name definitions in user `data/agent-profiles/` and project `.nerve/agent-profiles/`; same-name project definitions shadow lower definitions and require exact-byte trust. Conversations store applied snapshots in `config/agent.json`; catalog changes do not alter them until explicit switch/reapplication. Use settings/Recommend/Require replace materialized template writes. Children freeze their own underlying defaults/profile and launch model/thinking choices, never the lead's effective preferences. Requirements remain separate; children cannot delegate, ask the user or use `plan_present`.

## Background commands and launches

`bash` can return immediately with `background: true` or promote a long-running foreground command according to Bash settings. Core tracks these runs durably; `async_bash` lists, reads logs or stops them. Completion queues a notice. A child with background commands can finish its execution, accept follow-ups and wake again when a command completes.

`launch` is separate host-managed work: user-defined run configurations live in `.nerve/launches/definitions.json`, while launch instances are memory-only. Agents can inspect/start/restart/stop them but have no definition-editing tool action.

## Recovery

On restart, unfinished inputs and tool rows drive recovery. Suspended interactions remain available. Not-yet-started calls are re-captured and re-admitted under current configuration; changed targets need fresh approval. Invalid security configuration waits configuration-blocked with Retry/Cancel, never Baseline fallback. Running effects are replayed only when declared safe; uncertain outcomes settle as `indeterminate`. The workbench process adapter cannot reconstruct native handles after restart, so previously running async Bash records become `lost`; commands are not replayed. Launch instances are not recovered. Ephemeral streaming frames are not replayed.

## Next steps

- [Tools and policy](/developers/tools-policy/)
- [Tool output lifecycle](/developers/tool-output-lifecycle/)
- [Agent profiles](/reference/agent-profiles/)
- [Protocol](/developers/protocol/)
