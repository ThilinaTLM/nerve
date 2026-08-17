---
title: Jira
description: Enable credentialed Jira reads and supervised issue mutations.
sidebar:
  order: 3
---

Jira tools are absent until the Jira module is enabled and configured in Settings. Configure the Atlassian endpoint and credentials for the account and site you intend the agent to use.

Nerve exposes Jira operations for users, issues, projects, boards, sprints, backlogs, attachments, comments, worklogs, and issue links. Read operations are network reads and can run in parallel. Mutations are sequential write-capable calls and pass the active permission/approval policy.

The tool surface is single-target: each mutation changes one issue, comment, worklog, link, attachment, sprint, or backlog placement. Related resource mutations use an explicit `action` such as `create`, `update`, or `delete`. Jira Software board, sprint, and backlog tools require the configured site and project to provide Jira Software APIs. Attachment transfers are capped at 25 MiB and downloads are written to local artifacts; attachment bytes are never injected into the model context.

Use `jira_get_issue` to discover comment, worklog, issue-link, and attachment IDs before changing them. `jira_manage_attachment` uses `action: "upload"` with `issue_key` and `file_path`, or `action: "delete"` with `attachment_id`; deletion is destructive. Calls that previously used `jira_upload_attachment` should use `jira_manage_attachment` with `action: "upload"`. Use `jira_get_project` with issue-link types before creating links. All new mutations support `dry_run`.

Read-only agent permission blocks Jira network calls, even operations classified as read-only network access. Use supervised permission when you want the agent to research Jira and ask before changes.

Results are bounded; narrow queries and limits improve context use. Larger/raw data can be stored as artifacts rather than injected in full.

:::caution
Jira queries send project information to Atlassian, and mutations act with the configured account's permissions. Review issue keys, site, fields, transitions, and comments before approval.
:::

## Next steps

- [Agent controls](/guides/agent-controls/)
- [Security model](/operations/security/)
