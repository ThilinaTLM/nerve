---
name: atlassian-code-mode
description: Usage guide for Nerve's `atlassian_code_mode` tool (scripted Jira + Confluence access).
---

# Atlassian code mode

`atlassian_code_mode` runs a TypeScript script in a sandbox with these globals: `jira`, `confluence`, `diagram`, `files` and `image(handle)` (async host clients), `storage` (pure string builders for Confluence storage XHTML), and the libraries `XLSX` (SheetJS) and `Papa` (Papa Parse), which load only when the script mentions them. The sandbox has no network, filesystem or imports beyond these globals.

Method references (read the one you need before using it):

- [jira.md](jira.md): `jira.*` methods, issue shape, field names
- [confluence.md](confluence.md): page style and linter, `confluence.*` methods (pages, attachments, labels, comments), `diagram.render`, body formats
- [files.md](files.md): artifacts and file handles, `files.*`, `image(...)`, `XLSX`/`Papa`
- [storage.md](storage.md): `storage.*` builders; pages are written as storage XHTML (headings, tables, panels, images, layouts)

## Rules

- The script is an ES module body; use top-level `await`. Output is what you `console.log` plus a top-level `return value`, which prints compactly (an array of flat objects as a text table, a string as is, anything else as JSON). Do not `import` or `export`.
- Every SDK method takes one argument: a bare id/query string or one options object (`jira.issues.get({ key, fields })`, `confluence.pages.update({ id, body })`); a page id is always `id`, an issue or project id is `key`. Unknown options throw and list the valid ones.
- Errors (bad args, HTTP failures, policy denials) throw `HostError` with `e.code` (`FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `DENIED`). Let it fail the script, or `try/catch` to continue. An invalid API token (401) stops the whole script with one message.
- Raw escape hatches: `jira.request(method, path, body?)` and `confluence.request(method, path, body?)` for endpoints the methods do not cover.
- JQL must be bounded by a field restriction (e.g. `project = APP AND ...`); a bare `ORDER BY` is rejected. Set `limit` and request only needed `fields`.
- Batch in code: loop or `Promise.all` over keys/pages, filter and aggregate in the script, and print only the compact result instead of dumping raw data.
- Confluence pages are written as storage XHTML built with `storage.*`. Read "Page style" in confluence.md before creating or updating a page. The result automatically lists the linter's `fixes` and `warnings` for every page written and the artifacts created, so you do not need to print them; react to the warnings.
- Write methods (`confluence.pages.create`, `pages.update`, `attachments.upload`, `labels.add`, `comments.add`, and `request()` with a non-GET method) only on explicit user request. Read back or print the returned `url`/`version` so the user can verify.
- Results are plain objects. Text fields (issue descriptions, comments, page bodies) are Markdown.

## Example

```ts
const issues = await jira.issues.search({
  jql: "project = APP AND statusCategory != Done ORDER BY updated DESC",
  fields: ["summary", "status", "Story Points"],
  limit: 100,
});
const byStatus = Object.groupBy(issues, (i) => i.status ?? "none");
for (const [status, list] of Object.entries(byStatus)) {
  console.log(status, list?.length);
}
```
