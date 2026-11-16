---
title: Confluence
description: Let the agent search, read and write Confluence pages through Quick script.
sidebar:
  order: 4
---

Confluence is reached through the `confluence` namespace of [Quick script](/guides/quick-script/), provided by the [Atlassian extension](/integrations/extensions/#atlassian), with the same account selection, project overrides and connection status described for [Jira](/integrations/jira/). Switch on Confluence in **Settings → Extensions → Atlassian**; Quick script is on by default and has its own switch under **Settings → Tools**.

Typed methods cover spaces, page search and reads, page create, update and move, comments, labels, attachments, trash, restore and permanent purge; a raw `confluence.request` covers the rest of the REST API, such as page restrictions. Page bodies are written as Markdown or the `storage` helpers and checked against Confluence's storage format before they are sent, and the run reports what it created and changed. Confluence Cloud has no supported REST API for archiving pages, so there is no archive method. `sdk.describe("confluence")` and `sdk.docs("confluence")` list methods and writing rules for the agent.

Each SDK call is checked against your permission policy as an operation such as `confluence.pages.update` with the space or page it acts on (`confluence:page/123`); deletes and raw non-GET requests are destructive. Read-only and Planning allow reads and deny writes. Supervised asks before every call, so you can inspect the operations, pages and attachment paths in each approval.

:::caution
Confluence content and local attachment data leave the machine for Atlassian. The configured account may have broad publication rights. Verify the target space and page before approval.
:::

## Next steps

- [Tool reference](/reference/tools/)
- [Security model](/operations/security/)
