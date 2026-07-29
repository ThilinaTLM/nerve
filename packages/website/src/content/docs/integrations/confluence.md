---
title: Confluence
description: Search, download, create, update, publish, and attach Confluence content.
sidebar:
  order: 4
---

Confluence tools become available after its Settings module and credentials are enabled. Reads include space/page lookup, search, and page download. Mutations include create, update, publish, and attachment upload.

Read calls are parallel network operations that favor narrow limits and artifacts. Write calls are sequential and pass tool policy; supported operations use dry-run behavior where the catalog provides it. Planning mode excludes mutating Confluence tools.

Read-only agent permission blocks Confluence network access. Use supervised permission to inspect proposed page IDs, parents, versions, body changes, publication state, and attachment paths.

:::caution
Confluence content and local attachment data leave the machine for Atlassian. The configured account may have broad publication rights. Verify the target space and page before approval.
:::

## Next steps

- [Tool reference](/reference/tools/)
- [Security model](/operations/security/)
