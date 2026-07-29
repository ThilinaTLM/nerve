---
title: Jira
description: Enable credentialed Jira reads and supervised issue mutations.
sidebar:
  order: 3
---

Jira tools are absent until the Jira module is enabled and configured in Settings. Configure the Atlassian endpoint and credentials for the account and site you intend the agent to use.

Nerve exposes Jira operations for user, issue, and project lookup plus issue creation/update, comments, and transitions. Read operations are network reads and can run in parallel. Mutations are sequential write-capable calls and pass the active permission/approval policy.

Read-only agent permission blocks Jira network calls, even operations classified as read-only network access. Use supervised permission when you want the agent to research Jira and ask before changes.

Results are bounded; narrow queries and limits improve context use. Larger/raw data can be stored as artifacts rather than injected in full.

:::caution
Jira queries send project information to Atlassian, and mutations act with the configured account's permissions. Review issue keys, site, fields, transitions, and comments before approval.
:::

## Next steps

- [Agent controls](/guides/agent-controls/)
- [Security model](/operations/security/)
