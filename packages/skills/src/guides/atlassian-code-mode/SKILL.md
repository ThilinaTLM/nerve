---
name: atlassian-code-mode
description: Usage guide for Nerve's `atlassian_code_mode` tool (scripted Jira + Confluence access).
---

# Atlassian code mode

A TypeScript sandbox script (no network, filesystem or imports) with globals `jira`, `confluence`, `files`, `image`, `diagram`, `storage`, and `XLSX`/`Papa` (loaded when mentioned).

## Rules

1. ES module body with top-level `await`; no `import`/`export`. Output is `console.log` plus a top-level `return value`.
2. JQL needs a field restriction (`project = APP AND ...`). Always set `limit` and `fields`; filter in JQL/CQL first, then in code.
3. Methods take one argument: a bare string (key, id, JQL, CQL) or one options object. Issues and projects use `key`, pages `id`. Except `files.*`, `image(...)`, `request(method, path, body?)`.
4. Write only on explicit user request; print `url`/`version`/`key`. Page lint `fixes`/`warnings` and artifacts are listed for you.
5. Failures throw `HostError` with `e.code` (`FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `DENIED`); finished calls are not undone. A rejected token (401) stops it.
6. Jira/Confluence text is Markdown; pages are written as storage XHTML via `storage.*`.

## Read first (before any other tool or code)

| If the task involves                                     | Read                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Excel/CSV/images/diagrams/local files                    | [files.md](references/files.md), [files.d.ts](references/files.d.ts). Use `XLSX`/`Papa`/`image`/`diagram` here, never python or bash |
| Learning how a project is run; creating/updating tickets | [jira-workflows.md](references/jira-workflows.md)                                                                                    |
| Jira calls / Confluence calls                            | [jira.d.ts](references/jira.d.ts) / [confluence.d.ts](references/confluence.d.ts)                                                    |
| Writing a page                                           | [confluence-writing.md](references/confluence-writing.md), [storage.md](references/storage.md)                                       |
| Saving what you learned about a project                  | [project-knowledge.md](references/project-knowledge.md) (needs the `skill-creator` skill)                                            |

```ts
const issues = await jira.issues.search({
  jql: "project = APP AND statusCategory != Done",
  fields: ["summary", "status"],
  limit: 50,
});
return issues.map((i) => ({ key: i.key, status: i.status }));
```
