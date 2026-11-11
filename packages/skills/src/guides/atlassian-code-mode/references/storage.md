# `storage.*` builders

Pure functions (no host calls) returning Confluence storage XHTML strings. Join them into a page body and pass it as the `body` of `pages.create/update` (always storage XHTML) or `comments.add` with `format: "storage"`. Plain strings are always escaped, so Jira or user text can be passed safely. Only builder output (`storage.*`, including `markdown`) and `storage.raw(xhtml)` count as markup, and only the exact returned string: concatenating (`a + b`) produces plain text that is escaped. Combine fragments by passing an array, or wrap hand-written markup in `storage.raw`. Body arguments (`RichText`) take a plain string (Markdown, HTML in it is escaped), builder output, or an array of parts joined in order. Style and linting: [confluence-writing.md](confluence-writing.md).

- `storage.h1(text)`, `storage.h2(text)`, `storage.h3(text)`: headings.
- `storage.p(body)`: paragraph. `body` is a string (escaped), builder output, or an array mixing both: `storage.p(["Due ", storage.date(d), " ", storage.status("Done")])`.
- `storage.raw(xhtml)`: trusted hand-written storage fragment, embedded as is. Never pass untrusted text.
- `storage.markdown(md)`: real storage markup from Markdown (headings, lists, task lists, tables, fenced code, blockquotes, image URLs; raw HTML is escaped).
- `storage.escape(text)`: escapes `& < > "` for markup written inside `storage.raw`.
- `storage.link(url, text?)` (http(s), mailto, relative and `#anchor` URLs only; others throw), `storage.date(isoDate)`, `storage.mention(accountId)` (ids from `jira.users.search`).
- `storage.tasks(items)`: items are strings or `{ text, done? }`; `text` may be an array like `p`'s body. Ids are unique per page, also together with `storage.markdown` task lists.
- `storage.toc()`: table of contents.
- `storage.panel(type, body, { title? })`: `type` is `"info" | "success" | "warning" | "error" | "note"`; other values throw.
- `storage.expand(title, body)`: collapsible section.
- `storage.status(text, colour?)`: lozenge; colour `"Grey"` (default), `"Red"`, `"Yellow"`, `"Green"`, `"Blue"`, `"Purple"`.
- `storage.code(code, { language?, title? })`: code block.
- `storage.jiraIssue(key)`: single issue macro.
- `storage.jiraIssues(jql, { columns?, limit?, layout?, serverId? })`: issue list macro. `columns` is a string[] such as `["type","key","summary","status"]` (`type` is a narrow icon column; also assignee, reporter, priority, resolution, created, updated, due, or custom field names). `limit` sets maximum issues. `layout` is `"default"` (760 px), `"wide"` or `"full-width"`. Omit `serverId` unless the site has several Jira links.
- `storage.table(rows, { columns?, layout? })`: `rows` are objects or string[][]. `columns` are keys or `{ key, title?, width? }` (px; columns without width share the rest; none given: the linter sizes them). For string[][] the first row is the header unless `columns` is given. Cells holding builder output (`status`, `jiraIssue`, ...) are embedded as is (an array of parts is joined); plain strings are escaped. Widths must be positive numbers. `layout` as for `jiraIssues`.
- `storage.image(filename, { width?, alt?, caption?, align? })`: an attached PNG/JPEG; width defaults to the real size capped at 760. `align` defaults to `"center"`. Attach the file via `attachments` or `confluence.attachments.upload`.
- `storage.layout(cells, { type? })`: 2 cells (3 for `"three_equal"`; other types `"two_equal"` default, `"two_left_sidebar"`, `"two_right_sidebar"`), each Markdown or storage. Do not nest.
