---
title: Tools and approval policy
description: Understand the tool manifest, execution lifecycle, risk decisions, and mode restrictions.
sidebar:
  order: 4
---

The contracts and tool manifest define the agent-callable catalog. Definitions declare schemas, risk traits, availability, and parallel/sequential execution. Executors return bounded content plus artifacts/transcripts when needed.

## Local versus host tools

Local executors cover files/search, Bash/Python, Web, Jira and Confluence. Conversation-core handlers own questions, to-dos, asynchronous sub-agent delegation and plan review. The server supplies host integrations, including the `launch` tool for user-defined run configurations.

Accepted calls use the durable core tool lifecycle. File mutations serialize per path. Python remains finite; Bash can return immediately in the background or promote after its configured foreground limit. `async_bash` manages conversation-owned runs; `launch` manages separate workbench launch instances. Async Bash queues completion notices instead of requiring polling. Agent-started launches queue exit notices when they finish naturally while the daemon retains their in-memory ownership; cancelled launches suppress those notices, and launch ownership does not survive restart. See [tool output lifecycle](/developers/tool-output-lifecycle/) for the execution states, durable/live event split, and output budgets.

## Policy decisions

The server composes Baseline with one selected permission rule set:

- **Read only** allows interaction, local inspection, and sub-agent delegation, then denies other capabilities;
- **Supervised** allows interaction and local inspection, then prompts for other capabilities;
- **Autonomous** allows valid requests unless a scoped overlay or guardrail replaces the decision;
- **Planning** allows research, interaction, sub-agent delegation, and plan-file writes, prompts for local analysis commands, and denies other mutations;
- custom user rule sets can define another ordered policy for compatible agent modes.

Sub-agent delegation under Read only and Planning is not tied to the lead's mode: a lead may assign any profile, and each sub-agent runs under its own profile's rule set.

The permission engine combines manifest metadata, normalized arguments and targets, the selected rule set, and matching overlays to produce `allow`, `prompt`, or `deny`. A prompt becomes a durable Workbench approval interaction. Multi-target calls are automatically allowed only when the winning allow rule covers every relevant target.

## Rule-set-scoped overlays

User, project, and conversation overlays are each bound to exactly one permission rule set. A Planning grant does not affect Supervised or Autonomous, and a coding grant does not affect Planning. Ownership scopes still determine precedence within that rule set: conversation replaces project, project replaces ordinary user rules, and user guardrails cannot be overridden.

User overlays are stored under `<NERVE_HOME>/config/permissions.json`; project overlays are stored under `<project>/.nerve/config/permissions.json`; conversation overlays are stored with managed conversation data. Each scope uses one atomic document containing groups shaped as `overlays: [{ ruleSetId, rules }]`, rather than one file per rule set. The complete project document digest must be trusted before any project group is active.

Durable approval choices retain the permission rule set captured when the call was evaluated. Changing a conversation's selected rule set while an approval is pending cannot redirect the saved grant. If a selected custom set becomes missing, malformed, disabled, or incompatible, the host falls back to Baseline without applying overlays.

Rules can match tool names/groups, risks, validated arguments, and canonical path or URL targets. Portable path matchers use rooted POSIX patterns such as `src/**`; external host-specific paths use exact argument matching. Rules apply to Nerve's corresponding tools and are not an operating-system sandbox.

## Distinctions

Git/GitHub Workbench actions are HTTP routes, not manifest tools. Agents use Git through Bash. Agent Browser is imported skill guidance, not a tool. UI confirmations for direct Git/PR actions are outside agent tool lifecycle.

:::caution
Tool policy is application authorization, not process/container isolation. Bash, Python, project instructions, and credentials remain powerful local capabilities.
:::

## Next steps

- [Tool reference](/reference/tools/)
- [Security model](/operations/security/)
