---
title: Jira
description: Let the agent read and change Jira issues, boards and sprints through quick_script.
sidebar:
  order: 3
---

Jira is reached through the `jira` namespace of the `quick_script` tool, provided by the Atlassian extension. Add an Atlassian account (site, email, API token) and select it in **Settings → Extensions → Atlassian**, then switch on Jira there and turn on **Quick script** under **Settings → Tools**. A project can pin its own extension settings in `.nerve/config/extensions.json`; per-conversation tool switches sit under **Capabilities → Tools** beside the composer. The agent sees the `jira` namespace only when the extension is on and the selected account exists with a saved token.

Each Atlassian account shows its connection status for Jira and Confluence: verified, credentials rejected, access restricted, not on this site, or couldn't check. Use **Test connection** to check now; Nerve also re-checks stale results when the page opens and updates the status when a Jira call succeeds or is refused with 401.

The agent writes one short script for a task instead of one tool call per request: typed methods cover users, issues, projects, boards, sprints, backlogs, attachments, comments, worklogs and issue links, and a raw `jira.request` covers the rest of the REST API. The agent discovers methods with `sdk.describe("jira")` and `sdk.docs("jira")` inside the script. Only the script's printed output returns to the conversation, and attachment bytes never enter the model context.

Each SDK call is checked against your permission policy as an **operation** such as `jira.issues.create`, with the issue or project it acts on (`jira:issue/APP-12`). Reads are network operations; creating and changing issues are external writes; deletes and raw non-GET requests are destructive. In **Settings → Permissions** you can allow, prompt or deny by operation, for example a rule that lets the agent edit issues in one project only.

Read-only agent permission blocks Jira network calls. Use supervised permission when you want the agent to research Jira and ask before changes.

:::caution
Jira queries send project information to Atlassian, and changes act with the configured account's permissions. Review the operations and targets listed in the approval before accepting.
:::

## Next steps

- [Agent controls](/guides/agent-controls/)
- [Security model](/operations/security/)
