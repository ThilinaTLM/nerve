---
title: Tools and approval policy
description: Understand the tool manifest, execution lifecycle, risk decisions, and mode restrictions.
sidebar:
  order: 4
---

The contracts and tool manifest define 50 agent-callable names. Definitions declare schemas, risk traits, availability, and parallel/sequential execution. Executors return bounded content plus artifacts/transcripts when needed.

## Local versus host tools

Local executors cover files/search, finite Bash/Python, Web, Jira, and Confluence. Host-mediated tools cover questions, to-dos, background tasks, Explore, and plan review because they need durable Workbench state or suspend the run.

Every dispatch produces persisted lifecycle records. File mutations serialize per path; shell/Python can stream but remain finite; supervised task processes are separate. See [tool output lifecycle](/developers/tool-output-lifecycle/) for the execution states, durable/live event split, and output budgets.

## Policy decisions

The server evaluates mode, permission, risk, tool availability, and request details:

- read-only denies non-read actions and all ordinary network/child spawning;
- supervised requests approval for non-read risks, with optional read autoapproval and risk-bound always-allow grants;
- effective grants are the deduplicated union of global settings and host-side project permissions under `~/.nerve/projects/<project-id>/permissions.json`; workspace `.nerve` files are never authoritative permission sources;
- autonomous permits allowed risks without normal approval;
- planning adds path-constrained writes, tool omissions, and shell guardrails.

The supervision engine evaluates the manifest risk, argument-sensitive refinements, agent permission level, hard host constraints, and user preferences to produce one `allow`, `approval`, or `deny` decision. Compound Bash calls are parsed into segments; every segment must be known read-only or match a normalized command-prefix grant before the call can run without approval.

Approval can authorize a policy-permitted action. It cannot override a hard read-only or planning denial.

## Distinctions

Git/GitHub Workbench actions are HTTP routes, not manifest tools. Agents use Git through Bash. Agent Browser is imported skill guidance, not a tool. UI confirmations for direct Git/PR actions are outside agent tool lifecycle.

:::caution
Tool policy is application authorization, not process/container isolation. Bash, Python, project instructions, and credentials remain powerful local capabilities.
:::

## Next steps

- [Tool reference](/reference/tools/)
- [Security model](/operations/security/)
