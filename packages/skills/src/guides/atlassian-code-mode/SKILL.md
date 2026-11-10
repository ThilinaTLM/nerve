---
name: atlassian-code-mode
description: Usage guide for Nerve's `atlassian_code_mode` tool (scripted Jira + Confluence access).
---

# Atlassian code mode

`atlassian_code_mode` runs a TypeScript script in a sandbox with four globals: `jira`, `confluence`, `diagram` (async API clients) and `storage` (pure string builders for Confluence storage XHTML). The sandbox has no network, filesystem or imports beyond these globals.

Method references (read the one you need before using it):

- [jira.md](jira.md): `jira.*` methods, issue shape, field names
- [confluence.md](confluence.md): page style and linter, `confluence.*` methods (pages, attachments, labels, comments), `diagram.render`, body formats
- [storage.md](storage.md): `storage.*` builders; pages are written as storage XHTML (headings, tables, panels, images, layouts)

## Rules

- The script is an ES module; use top-level `await`. Output is only what you `console.log` (objects are fine, prefer `JSON.stringify` for large data). There is no `return` and the final expression is not printed.
- Errors (bad args, HTTP failures, policy denials) throw `HostError`. Let it fail the script, or `try/catch` to continue and log `e.message`.
- JQL must be bounded by a field restriction (e.g. `project = APP AND ...`); a bare `ORDER BY` is rejected. Set `limit` and request only needed `fields`.
- Batch in code: loop or `Promise.all` over keys/pages, filter and aggregate in the script, and print only the compact result instead of dumping raw data.
- Confluence pages are written as storage XHTML built with `storage.*`. Read "Page style" in confluence.md before creating or updating a page, and print the `fixes` and `warnings` the linter returns.
- Write methods (`confluence.pages.create`, `pages.update`, `attachments.upload`, `labels.add`, `comments.add`) only on explicit user request. Read back or print the returned `url`/`version` so the user can verify.
- Results are plain objects. Text fields (issue descriptions, comments, page bodies) are Markdown. Identifier arguments accept the bare value or an object with aliases (see references).

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
