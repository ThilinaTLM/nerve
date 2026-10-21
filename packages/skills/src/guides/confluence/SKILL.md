---
name: confluence
description: Usage guide for Nerve's Confluence tools.
---

# Confluence tools

Mutate Confluence only when the user explicitly requests it. Use `dry_run: true` to preview/validate changes without publishing.

## Find and read

- Resolve spaces with confluence_search_spaces using exact keys/IDs. Prefer narrow page queries: space_key/space_id and exact title, or CQL such as `type = page AND space = "DOC" AND title = "Runbook"`. For text search use `type = page AND space = "DOC" AND text ~ "deployment"`. Quote/escape CQL values; do not mix JQL fields/operators into CQL. `query` supports free-text search.
- Search limits default to 25 (max 100). Continue with the returned opaque cursor unchanged and the same filters; do not invent numeric offsets. CQL/free-text pagination is also exposed through this cursor interface.
- confluence_get_page fetches one page. Select body_format (storage by default) and include only needed labels, properties, operations, version/versions, children, attachments, footer_comments, inline_comments, restrictions. Comment pagination uses comment_limit/comment_cursor. Related previews and tool text are bounded; inspect the saved JSON artifact for full returned data.
- confluence_download_page saves a page bundle with editable page JSONL and storage XML/ADF body artifacts. attachments is none (default), metadata, or download. Downloads save local artifacts, not remote changes. Markdown sidecars are optional via markdown.

## Editable source and publishing

Storage XML or JSON/JSONL is the source of truth. Markdown is a read-only sidecar, never the publishing source. Preserve Confluence macros, namespaces, attachment references, and IDs when editing storage XML. Use file tools for targeted edits rather than rewriting from rendered Markdown.

1. Download/read the page before editing. Keep the page row's ID and version.
2. Edit the storage XML/body file or page JSON/JSONL row. If editing the separate body artifact, pass it as body_file alongside page_file; page_file reads its embedded body.value, not the sidecar automatically. `page_file` must resolve to exactly one page row; a manifest/directory is accepted only when its pages.jsonl has one row. JSON/JSONL rows carry page metadata and body representation/value.
3. Preview with create/update and dry_run, then publish only the requested change. `return_page: true` fetches the resulting page.

- Create needs a title and body, with space_id/space_key (or the configured default space); parent_id is optional. status is current or draft.
- Body inputs are inline `body`, `body_file`, or a `page_file` body. Do not supply both body and body_file. Explicit arguments override page-file values. body_representation is storage (XML, default), atlas_doc_format (serialized ADF JSON), or wiki; it must match the content. Read formats view/export_view/anonymous_export_view/styled_view/editor are not write representations.
- Update accepts page_id or the row ID. It fetches the current version and increments it; omitted title/body retain the current values. version_message documents the change. A stale page-file version is rejected: re-download and reconcile, rather than using allow_stale unless overwriting is explicitly intended.
- Storage links can reference Confluence pages/attachments (preserve `ac:link`/`ri:page`/`ri:attachment` structures); web links use normal XHTML anchors. Use known page IDs/space keys and attachment names; inspect existing storage before changing links.

## Related mutations

- Comments have kind footer/inline. Create requires page_id and body; update requires comment_id and body; delete/resolve/reopen require comment_id. resolve/reopen apply only to inline comments. body_representation is storage or atlas_doc_format. parent_comment_id supports replies; inline_properties supplies Confluence inline-selection metadata. Updates support version_message and allow_stale.
- Page lifecycle actions are trash, restore, purge. Purge is permanent; only perform the action requested.
- Labels: add/remove with page_id and label; prefix applies only to add.
- Restrictions: operation is read/update. add/remove require subject_type user/group and subject_id (user account ID or group ID); clear_operation removes restrictions for the operation. Inspect current restrictions before changing access.
- Attachments: upload requires page_id and local file_path (content is sent to Confluence); filename overrides its name. update_existing can replace a matching attachment; minor_edit/comment/status affect the upload. Rename requires attachment_id and new_filename; delete requires attachment_id. Download page with attachment metadata first to discover IDs/names; use attachments: download when local files are needed. Uploads and downloads are limited to 25 MiB per attachment.
