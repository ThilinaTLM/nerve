---
title: Confluence
description: Search, download, and manage single Confluence pages and their resources.
sidebar:
  order: 4
---

Confluence tools become available after its Settings module and credentials are enabled. Reads include space/page lookup, search, and a single-page download. Mutations include page create/update, comments, supported page lifecycle actions, labels, restrictions, and attachments.

The tool surface is single-target: there is no subtree/space download or multi-page publishing tool. `confluence_download_page` downloads exactly one page into editable JSON/storage XML artifacts, and `confluence_update_page` is the only file-backed publishing path. Related resource mutations use an explicit `action`; labels and restriction subjects are changed one at a time.

`confluence_manage_page` supports `trash`, `restore`, and permanent `purge`. Confluence Cloud does not provide a supported REST API for page archive, so Nerve does not expose an archive action. Use `dry_run` before mutations when you want remote target/state validation without writing.

Read calls are parallel network operations that favor narrow limits and artifacts. Write calls are sequential and pass tool policy; supported operations use dry-run behavior where the catalog provides it. Planning mode excludes mutating Confluence tools.

Read-only agent permission blocks Confluence network access. Use supervised permission to inspect proposed page IDs, parents, versions, body changes, publication state, and attachment paths.

:::caution
Confluence content and local attachment data leave the machine for Atlassian. The configured account may have broad publication rights. Verify the target space and page before approval.
:::

## Next steps

- [Tool reference](/reference/tools/)
- [Security model](/operations/security/)
