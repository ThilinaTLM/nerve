# `storage.*`

Pure string builders for Confluence storage XHTML, the primary page format. They run in the sandbox without host calls and return strings you concatenate into a page body (`[storage.h1("Overview"), storage.p("..."), ...].join("")`). Pass the result to `pages.create`/`pages.update` (default `format: "storage"`) or `comments.add`. The page is linted on write; see "Page style" in [confluence.md](confluence.md).

Body arguments (`body` of `panel`/`expand`) take Markdown or storage XHTML: a string starting with `<` or containing helper output is treated as storage, anything else as Markdown.

## `storage.h1(text)`, `storage.h2(text)`, `storage.h3(text)`

Headings from plain text (escaped). Sections start at `h1`; the page title is a separate field.

## `storage.p(textOrStorage)`

A paragraph. Plain text is escaped; a string containing tags (e.g. built with `storage.link`/`storage.status`) is embedded as storage, so use `storage.escape` for literal angle brackets; `storage.markdown()` output is returned as is (it already produces its own blocks).

## `storage.link(url, text?)`

Hyperlink; `text` defaults to the URL.

## `storage.markdown(md)`

Returns an opaque placeholder string; the Markdown is converted to storage XHTML host-side when the page is written. **Treat helper output as opaque**: only concatenate it. Do not `replace`, `match`, slice or log it expecting readable XHTML, and do not try to convert it yourself. Placeholders are not expanded in values you print, only in bodies sent through `pages.create`/`pages.update`/`comments.add` (with `format: "storage"` or auto-detected).

## `storage.escape(text)`

Escapes `& < > "` for embedding plain text in XHTML.

## `storage.toc()`

Table-of-contents macro.

## `storage.panel(type, body, { title? })`

`type` uses the Confluence Cloud panel names, mapped to the storage macro that renders that colour: `"info"` (blue, `info` macro), `"success"` (green, `tip`), `"warning"` (yellow, `note`), `"error"` (red, `warning`), `"note"` (purple, a `panel` macro with purple border and fill). The legacy name `"tip"` is accepted as `"success"`. Other types throw. `body` is Markdown, storage XHTML, or an array of parts (each part Markdown or storage, joined in order).

When to use which: `info` for context and the page overview; `success` for good news (done, on track); `warning` for risks and things to watch; `error` only for blocking problems or failures; `note` for a side remark or definition. Use them sparingly: one overview panel at the top, a few elsewhere.

## `storage.expand(title, body)`

Expand (collapsible) macro; `body` as for `panel` (string or array of parts).

## `storage.status(text, colour?)`

Status lozenge. Colours: `"Grey"` (default), `"Red"`, `"Yellow"`, `"Green"`, `"Blue"`, `"Purple"` (case-insensitive; `gray` accepted; unknown → Grey).

## `storage.code(code, { language?, title? })`

Code block macro; code is wrapped in CDATA (safe for `]]>`).

## `storage.jiraIssue(key)`

Jira issue macro for one key.

## `storage.jiraIssues(jql, { columns?, limit?, layout?, serverId? })`

Jira issue-list macro for a JQL query. `columns` is a string[] (or a comma/semicolon separated string); it is written to the macro as the semicolon-separated list Confluence expects (`key;summary;status`). Known column names: `type` (shown as a narrow icon column headed "T", not a text column), `key`, `summary`, `assignee`, `reporter`, `priority`, `status`, `resolution`, `created`, `updated`, `due`; custom fields by name. `limit` sets `maximumIssues`. `layout`: `"default"` (the default; keeps the list inside the 760 px column), `"wide"`, `"full-width"`; written as `data-layout` on the macro. Omit `serverId` unless the site has several Jira links. An empty result renders only a bare header row, so check the count in the script and write a sentence instead of the macro for sections that may be empty.

## `storage.table(rows, { columns?, layout? })`

`rows` is an array of objects or a string[][]. `columns` is an array of keys or `{ key, title?, width? }` (header = `title` or `key`; for string[][] rows the columns give the header and all rows are body rows; without `columns` the first row is the header). `width` is in px; columns without a width share the rest of the content width. If no column has a width the linter computes widths from the content. `layout`: `"default"` (760 px content width, the default), `"wide"` (960), `"full-width"` (1800). Cells that are storage/helper strings (for example `storage.status(...)`, `storage.jiraIssue(...)`) are embedded as is; other values are escaped into `<p>`.

## `storage.image(attachmentFilename, { width?, alt?, caption?, align? })`

An image attached to the page (upload it with `confluence.attachments.upload` or `attachments` in `pages.create/update`; PNG/JPEG). Omit `width` to let the linter set it from the real size, capped to the content width (760 px). `align` defaults to `"center"`.

## `storage.layout(cells, { type? })`

Multi-column section. `cells` is 2 strings (3 for `three_equal`); each cell takes Markdown or storage. `type`: `"two_equal"` (default), `"two_left_sidebar"`, `"two_right_sidebar"`, `"three_equal"`. Do not nest layouts.

## `storage.date(iso)`

Date lozenge for an ISO date (`2026-01-31`).

## `storage.mention(accountId)`

User mention by Atlassian account id (find ids with `jira.users.search`).

## `storage.tasks(items)`

Task list from `{ text, done? }` objects or plain strings.
