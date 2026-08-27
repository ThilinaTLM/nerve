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

- Read only allows local inspection and interaction, but denies commands, network access, mutations, and child spawning;
- Supervised automatically allows safe local reads and audited read-only integrations, then requests approval for other risks unless an exact-risk allow exception covers the complete request;
- Autonomous permits allowed risks without normal approval, but explicit block exceptions still apply;
- effective exceptions are the deduplicated union of user permissions under `~/.nerve/config/permissions.json` and project permissions under `<project>/.nerve/config/permissions.json`;
- planning adds path-constrained writes, tool omissions, and shell guardrails before generic permission evaluation.

The permission engine combines manifest and argument-sensitive risk, normalized request targets, permission level, hard host constraints, and typed user exceptions to produce `allow`, `approval`, or `deny`. Block exceptions win across scopes. Allow exceptions cannot expand Read only or bypass planning restrictions. Compound Bash calls are parsed into segments, and every mutating segment must match an exact-risk command-prefix exception before the call can run without approval. Python execution remains opaque and never receives a durable allow suggestion.

File path exceptions use project-relative POSIX globs such as `secrets/**`; web exceptions use exact or leading-wildcard hostnames. They apply to Nerve's corresponding tools and are not an operating-system sandbox.

## Distinctions

Git/GitHub Workbench actions are HTTP routes, not manifest tools. Agents use Git through Bash. Agent Browser is imported skill guidance, not a tool. UI confirmations for direct Git/PR actions are outside agent tool lifecycle.

:::caution
Tool policy is application authorization, not process/container isolation. Bash, Python, project instructions, and credentials remain powerful local capabilities.
:::

## Next steps

- [Tool reference](/reference/tools/)
- [Security model](/operations/security/)
