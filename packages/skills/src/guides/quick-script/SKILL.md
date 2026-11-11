---
name: quick-script
description: Usage guide for Nerve's `quick_script` tool (sandboxed scripts: Jira, Confluence, files, images, diagrams).
---

# quick_script

A TypeScript sandbox script (no network, filesystem or imports) with globals `atlassian`, `jira`, `confluence`, `files`, `image`, `diagram`, `storage`, and `XLSX`/`Papa` (loaded when mentioned).

## Rules

1. ES module body with top-level `await`; no `import`/`export`. Output is `console.log` plus a top-level `return value`.
2. Start with `await atlassian.defaults()` (`{ jira?, confluence? }`: site, default `project`/`space`, current `user`) instead of discovering them.
3. JQL needs a field restriction (`project = APP AND ...`). Always set `limit` and `fields`; filter in JQL/CQL first, then in code.
4. Methods take one argument: a bare string (key, id, JQL, CQL) or one options object. Issues and projects use `key`, pages `id`. Except `files.*`, `image(...)`, `request(method, path, body?, query?)`.
5. Write only on explicit user request; print `url`/`version`/`key`. Page lint, created entities (`Created: …`) and artifacts are listed for you.
6. Jira text is Markdown. Confluence page bodies are storage XHTML via `storage.*` (Markdown only inside `storage.markdown`). To edit a page read `body: "storage"`, change it and pass the `version` you read; a newer page throws `CONFLICT`. An update that removes macros/layouts/images/mentions is refused unless `allowRemoving: true`.
7. Failures throw `HostError` with `e.code`: `BAD_REQUEST` (also invalid arguments), `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `DENIED`, `RATE_LIMITED`, `SERVER_ERROR`. Finished calls are not undone; a rejected token (401) stops the run.
8. Destructive (needs approval, plan for it): `jira.issues.delete`, `jira.comments.delete`, non-GET `jira.request` / `confluence.request`.
9. Confluence CQL search lags right after a page is created; look up exact titles with `pages.get({ title })`.
10. Not typed yet? Use the raw requests: [raw-recipes.md](references/raw-recipes.md).

## Read first (before any other tool or code)

| If the task involves                                                         | Read                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Excel/CSV/images/diagrams/local files                                        | [files.md](references/files.md), [files.d.ts](references/files.d.ts). Use `XLSX`/`Papa`/`image`/`diagram` here, never python or bash                  |
| Learning how a project is run; creating/updating tickets                     | [jira-workflows.md](references/jira-workflows.md)                                                                                                     |
| Jira calls / Confluence calls                                                | [jira.d.ts](references/jira.d.ts) / [confluence.d.ts](references/confluence.d.ts) (`atlassian.defaults`: [atlassian.d.ts](references/atlassian.d.ts)) |
| Writing a page                                                               | [confluence-writing.md](references/confluence-writing.md), [storage.md](references/storage.md)                                                        |
| Something with no method (changelog, sprints, rank, comment resolve, trash…) | [raw-recipes.md](references/raw-recipes.md)                                                                                                           |
| Saving what you learned about a project                                      | [project-knowledge.md](references/project-knowledge.md) (needs the `skill-creator` skill)                                                             |

```ts
const issues = await jira.issues.search({
  jql: "project = APP AND statusCategory != Done",
  fields: ["summary", "status"],
  limit: 50,
});
return issues.map((i) => ({ key: i.key, status: i.status }));
```
