# `storage.*`

Pure string builders for Confluence storage XHTML. They run in the sandbox without host calls and return strings you concatenate into a page body. Pass the result to `pages.create`/`pages.update`/`comments.add` (the format is detected, or pass `format: "storage"`).

Body arguments (`body` of `panel`/`expand`) take Markdown or storage XHTML: a string starting with `<` or containing helper output is treated as storage, anything else as Markdown.

## `storage.markdown(md)`

Returns an opaque placeholder string; the Markdown is converted to storage XHTML host-side when the page is written. **Treat helper output as opaque**: only concatenate it. Do not `replace`, `match`, slice or log it expecting readable XHTML, and do not try to convert it yourself. Placeholders are not expanded in values you print, only in bodies sent through `pages.create`/`pages.update`/`comments.add` (with `format: "storage"` or auto-detected).

## `storage.escape(text)`

Escapes `& < > "` for embedding plain text in XHTML.

## `storage.toc()`

Table-of-contents macro.

## `storage.panel(type, body, { title? })`

`type`: `"info" | "note" | "warning" | "tip" | "success"` (`success` renders as `tip`). Other types throw.

## `storage.expand(title, body)`

Expand (collapsible) macro.

## `storage.status(text, colour?)`

Status lozenge. Colours: `"Grey"` (default), `"Red"`, `"Yellow"`, `"Green"`, `"Blue"`, `"Purple"` (case-insensitive; `gray` accepted; unknown → Grey).

## `storage.code(code, { language?, title? })`

Code block macro; code is wrapped in CDATA (safe for `]]>`).

## `storage.jiraIssue(key)`

Jira issue macro for one key.

## `storage.jiraIssues(jql, { columns? })`

Jira issue-list macro for a JQL query; `columns` is a string or string[].

## `storage.table(rows, { columns? })`

`rows` is either an array of objects (header = `columns` or the first row's keys) or a string[][] (first row is the header unless `columns` is given). Cells that are storage/helper strings are embedded as is; other values are escaped into `<p>`.
