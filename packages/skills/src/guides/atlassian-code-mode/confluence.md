# `confluence.*`

All methods are async and take **one argument**: a bare string (the page id for `pages.get`, the query for searches) or one options object. The page id is always called `id` (`pages.get`, `pages.update`, `labels.add`, `comments.add`, `attachments.upload`); there are no aliases, and unknown options throw and list the valid ones. The one exception is `confluence.request(method, path, body?)`. Page bodies read back as Markdown by default; write bodies as **Confluence storage XHTML** built with the `storage.*` helpers (see [storage.md](storage.md)), using Markdown only for prose.

## Page style

Build pages as storage XHTML with the typed helpers, not as one big Markdown string. Rules the linter enforces or warns about (see "Page linter"), and conventions it cannot check:

- **Title and headings.** The page title is a separate field. Sections start at `storage.h1` (never H2 first), subsections go one level down (`h2`, `h3`), never skip a level. Do not repeat the title as a first heading.
- **Overview first.** Open with a short overview (2-4 lines, or one panel) that says what the page is and its status; details follow.
- **Long pages get a TOC.** 3+ sections or ~600+ words: `storage.toc()` (the linter adds one if missing; `toc: false` opts out). Put it right after the overview.
- **Tables.** Columns are sized to content: short columns (key, type, status, date) narrow, text columns wide. The linter computes widths for tables that have none; pass `columns: [{ key, title, width }]` to `storage.table` to decide yourself (fixed-width page content is 760 px wide, `layout: "wide"` 960). Put status values in `storage.status` lozenges. Prefer a table for lists with several attributes.
- **Jira content.** For a list of issues use one `storage.jiraIssues(jql, { columns })` macro (columns such as `["key","summary","status","assignee"]`; `type` renders as a narrow "T" icon column) instead of one `storage.jiraIssue` per row, and do not add a heading per issue that only repeats its key. Use `storage.jiraIssue(key)` inline for a single reference in prose.
- **Panels have meaning.** `info` (blue): context and the overview. `success` (green): good news. `warning` (yellow): risks and things to watch. `error` (red): blocking problems only; never for neutral information. `note` (purple): side remarks. Do not put a panel directly under a heading with the same title, and do not stack panels.
- **Writing style.** Pluralise in code ("1 issue" / "3 issues"), never "issue(s)". Open with one short overview panel; do not add an H1 "Overview" whose content repeats it. Keep inline items (dates, lozenges, links) inside one `storage.p(...)` rather than as separate parts of a panel body.
- **Empty lists.** A Jira list macro whose JQL matches nothing renders only a bare header row. For sections that may be empty, count first (`jira.issues.search` with a small `limit`, or reuse results) and write a sentence ("No open blockers.") instead of the macro.
- **Images.** PNG or JPEG only (never SVG/WebP); attach the file, then reference it with `storage.image(filename)`. Images are sized to at most the content width (760 px); the linter fills in the width from the uploaded file. Add `alt`/`caption` when the image carries information. Diagrams: `diagram.render` produces a PNG; aim for a natural width close to 760 px. An image scaled below 80% of its width (a 1100 px diagram shown at 760 px) gets a warning because its text becomes small: simplify the diagram instead (for Mermaid use `flowchart TB`, fewer nodes per row, shorter labels).
- **Layout.** Use `storage.layout` sparingly (two columns for side-by-side summary and detail); do not nest layouts.
- **Collapse the long tail.** Put reference material, raw output and long lists in `storage.expand`. Code goes in `storage.code` with a language.

## Page linter

`pages.create` and `pages.update` (when a body is written) lint the body host-side. The result has `fixes: string[]` (applied automatically) and `warnings: string[]` (not applied). The tool result also lists them automatically after your output (with the artifacts created), so you need not print them; react to warnings by fixing the cause and calling `pages.update` again.

- **Malformed XML is an error**: the write is rejected before any request, with the line and element (for example `Closing tag </div> at line 2 does not match <p> opened at line 2`). Escape `&`, `<` with `storage.escape`; self-close `<br/>`.
- **Fixes**: headings promoted so the top level is H1; a leading H1 equal to the page title removed; a TOC inserted (`maxLevel` 2, after a leading panel) when there are 3+ top-level sections or ~600+ words and none exists; column widths computed for tables without them, never below the longest unbreakable word in a column (explicit widths are never overridden); `ac:width` set on images from the real size (capped to the content width) and clamped when too wide.
- Also fixed: loose inline content (text, dates, links, lozenges) directly under a panel, expand, layout cell, blockquote or the page root is wrapped in its own `<p>` (reported once); Jira issue-list macros without `data-layout` get `data-layout="default"` (Cloud otherwise renders them full-width, about 1760 px).
- **Warnings**: a column with explicit width too narrow for its longest unbreakable token (for example `Column "Key" is 90px; "SCRUM-4" needs about 100px and will wrap`; widen it or drop the explicit width); images scaled below 80%; skipped heading levels; SVG/WebP images; images with no known size; a heading directly followed by a panel with the same title; a heading whose only content is a single Jira macro with the same key; empty sections.

## Body formats

- `format: "storage"` (default) sends XHTML (`storage.markdown()` already returns real markup) after linting it. A body with no markup at all (does not start with `<`, no helper output) is treated as Markdown, since plain text is not meaningful storage.
- `format: "markdown"` converts the whole body to storage first (prose-only pages, comments). Headings, lists, tables, fenced code, task lists, blockquotes, images by URL are supported; raw HTML is escaped.
- `comments.add` bodies are Markdown unless `format: "storage"`. Any other `format` value throws.

## Page shape

`{ id, title, url, version }` is returned by create/update. `pages.get` adds `space`, `parentId`, `labels`, `body`, `children?`.

## `confluence.spaces.search({ query? })`

Bare string = the query. Case-insensitive "contains" on space key or name; empty returns all (scans up to 2500 spaces). Returns `{ id, key, name, type, url }[]`. An unknown `space` key in other methods lists close keys.

## `confluence.pages.search({ cql?, space?, title?, limit? })`

Bare string = the CQL. Conditions are ANDed: `cql` (wrapped in parentheses), `space` (key, equals), `title` (contains). With no `cql` it searches `type = page`; at least one of `cql`, `space`, `title` is required. `limit` defaults to 25, max 250. Returns `{ id, title, space, url, updated, parentId }[]`.

## `confluence.pages.get({ id, body?, children? })`

Bare string = the page id. Or look up by exact title: `{ space?, title, body?, children? }` (space defaults to the configured one; throws if no page matches).

- `body`: `"markdown"` (default), `"storage"` (raw XHTML), or `false` (omit the body).
- `children: true` adds `children: { id, title }[]` (direct children, first 100).

Returns `{ id, title, space, url, version, parentId, labels: string[], body?, children? }`; `space` is the key.

## `confluence.pages.create({ space?, title, parent?, body, format?, toc?, attachments? })`

Creates a page. `space` (a key) may be omitted to use the configured default; `parent` is a parent page id; `body` must be non-empty and is linted (see above). `toc: false` opts out of TOC insertion.

`attachments` is an array of file handles (`"artifact:flow.png"`, `"./shot.png"`) or `{ file, filename?, comment? }`; rules as in `attachments.upload`. Order: the attachments are read and validated first (so their sizes feed the linter), the page is created, the files are uploaded, and if the body references them (`storage.image`) the page is **saved once more** so the images resolve; that second save makes the returned `version` 2. A body that references an attachment you did not pass produces a warning.

Returns `{ id, title, url, version, fixes, warnings, attachments? }`.

## `confluence.pages.update({ id, title?, body?, format?, message?, toc?, attachments? })`

Provide `title` and/or `body`. The body is replaced wholesale (read it with `body: "storage"` first and edit in code when making partial changes); an omitted body or title keeps the current one, and an omitted body is not linted. The version is bumped for you; `message` is the version comment. `attachments` are uploaded before the page is saved. Returns `{ id, title, url, version, fixes, warnings, attachments? }`.

## `confluence.attachments.upload({ id, file, filename?, comment? })`

Uploads (or replaces, by filename) one attachment to page `id`. `file` is any file handle (see [files.md](files.md)): `artifact:<name>` or a workspace path (reading it needs the same permission as the `read` tool). Max 20 MB. `filename` defaults to the artifact name or file name. Images: PNG and JPEG are uploaded as is; GIF and WebP are converted to PNG (the filename gets a `.png` extension); SVG is rejected (render diagrams as PNG instead). Returns `{ id, filename, mediaType, size, width?, height? }`; `width`/`height` are the original pixel size for images. Reference an uploaded image with `storage.image(filename)`.

## `diagram.render({ type, source, name? })`

Renders a diagram through the configured Kroki server (the source is sent to it) as a PNG, saves it as an artifact and returns its handle (a string such as `artifact:diagram-1.png`; `name` picks the artifact name). Pass the handle as `file` to `confluence.attachments.upload` or in `pages.create/update` `attachments`, then reference the filename with `storage.image`; `image(handle)` can resize it first. `type` is a Kroki engine (`mermaid`, `d2`, `plantuml`, ...). Source max 128 KiB.

## `confluence.labels.add({ id, labels })`

`labels` is a string or string[]. Adds global labels to page `id`; returns `{ id, labels }` with the labels you added.

## `confluence.comments.add({ id, body, format? })`

Adds a footer comment (not inline) to page `id`. `body` is a non-empty string, Markdown unless `format: "storage"`. Returns `{ id, pageId }`.

## `confluence.request(method, path, body?)`

Raw REST call for anything the methods above do not cover. `method` is `GET`, `POST`, `PUT`, `PATCH` or `DELETE`; `path` is relative to the site and must start with `/wiki/api/v2/` (v2) or `/wiki/rest/api/` (v1); absolute URLs and other paths are rejected. `body` is sent as JSON. Returns the parsed JSON (or text; `null` when empty); responses over 5 MB throw. `GET` is permission-checked like a read, any other method like a destructive Confluence write.

## Errors

Failures throw `HostError` with `code`: `FORBIDDEN` (HTTP 403, message names the page or space), `NOT_FOUND`, `BAD_REQUEST`, `DENIED` (permission policy). An invalid token (HTTP 401) stops the whole script with one message.
