# `storage.*` builders and RichText

Pure functions (no host calls) returning Confluence storage markup. Bodies of `pages.create/update` and `comments.add/reply/update`, and every body argument below, are **RichText**: a Markdown string (HTML in it is escaped, so Jira/user text is safe), builder output, or an array of those joined in order. Markdown covers headings, lists, `- [ ]` tasks, tables, fenced code, quotes, `---`, bold/italic/code, links, `![alt](https://url)`. Builders cover what Markdown cannot. Style and linting: [confluence-writing.md](confluence-writing.md).

```ts
const page = await confluence.pages.get({ id, body: "storage" }); // page.body is trusted markup
await confluence.pages.update({
  id,
  version: page.version,
  body: [
    page.body, // existing content incl. drawio/gliffy/any macro, lossless
    "## Update\n\nShipped **2.1**; owner next.",
    storage.panel("info", [
      "Due ",
      storage.date("2026-05-01"),
      " ",
      storage.status("On track", "green"),
    ]),
    storage.raw(
      '<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">arch</ac:parameter></ac:structured-macro>',
    ),
  ],
});
```

Trust: only builder output, `storage.raw(xhtml)` and `pages.get({ body: "storage" })` bodies are markup, matched by exact string (per run). `page.body + "<p>x</p>"` or `.replace(...)` loses trust; a plain string that is really storage XHTML is **rejected** with this advice, never escaped silently. Combine with an array, `storage.replaceSection`, or `storage.raw`.

## Edit

- `storage.replaceSection(body, heading, content)`: `body` is `page.body`; replaces what follows the first heading whose text equals `heading` up to the next heading of the same or higher level (the heading stays). Throws listing the headings if absent.
- `storage.raw(xhtml)`: hand-written storage (add-on macros, anything else), embedded as is. Never pass untrusted text; `storage.escape(text)` escapes it inside raw markup.
- Large edits: `confluence.pages.download({ id })` then edit the file, then `pages.update({ id, version, bodyFile })` ([confluence-writing.md](confluence-writing.md)).

## Text

- `storage.heading(level, text)`: literal-text heading 1-6 (Markdown `#` headings interpret `*`, `_`, `#` in the text).
- `storage.p(body)`: paragraph of inline parts; a string is literal text, builder output is embedded: `storage.p(["Due ", storage.date(d), " ", storage.status("Open")])`. Keep inline items in one `p`.
- `storage.link(target, text?)`: target is a URL (http(s), mailto, relative, `#anchor`; others throw), `{ page, space?, anchor? }` (page by title), `{ attachment }` or `{ anchor }`.
- `storage.anchor(name)`: link target for `{ anchor }` links.
- `storage.date(isoDate)`: `YYYY-MM-DD`. `storage.mention(accountId)` (ids from `jira.users.search`). Unicode emoji work in plain text.
- `storage.tasks(items)`: strings or `{ text, done? }` (Markdown `- [ ]` lists work too). `storage.decisions(items)`: decision list, same items (`done: false` = undecided).

## Blocks

- `storage.panel(type, body, { title? })`: `"info" | "success" | "warning" | "error" | "note"`.
- `storage.expand(title, body)`: collapsible. `storage.excerpt(body, { hidden? })`; `storage.excerptInclude(pageTitle, { space?, noPanel? })`.
- `storage.code(code, { language?, title?, lineNumbers?, collapse? })`.
- `storage.status(text, colour?)`: lozenge; `"grey"` (default), `"red"`, `"yellow"`, `"green"`, `"blue"`, `"purple"`.
- `storage.table(rows, { columns?, layout?, headerRow?, headerColumn? })`: `rows` are objects or arrays (first array row is the header unless `columns` is given or `headerRow: false`). `columns` are keys or `{ key, title?, width? }` (px; none given: the linter sizes them). A cell is a string (literal), builder output, an array of parts, or `{ text, colspan?, rowspan? }`. `layout`: `"default"` (760 px), `"wide"` (960), `"full-width"`.
- `storage.layout(cells, { type? })`: `"two_equal"` (default for 2 cells), `"two_left_sidebar"`, `"two_right_sidebar"`, `"three_equal"` (default for 3), `"three_with_sidebars"`; each cell RichText. Do not nest.
- `storage.image(source, { width?, alt?, caption?, align?, border?, link? })`: an attachment filename (PNG/JPEG; width defaults to the real size capped at 760) or an `https://` URL.
- `storage.viewFile(filename, { height? })`: inline preview of an attached PDF/Office file.

## Macros

- `storage.toc({ minLevel?, maxLevel? })`, `storage.children({ depth?, all? })` (child pages), `storage.attachments()`.
- `storage.pageProperties({ Label: value, ... }, { hidden? })` (page properties table); `storage.propertiesReport(label, { space?, headings?, limit? })` lists pages carrying that properties label.
- `storage.jiraIssue(key)`: one issue inline.
- `storage.jiraIssues(jql, { columns?, limit?, layout?, serverId? })`: issue list. `columns`: `["type","key","summary","status"]` (also assignee, reporter, priority, resolution, created, updated, due, custom field names). Omit `serverId` unless the site has several Jira links.
