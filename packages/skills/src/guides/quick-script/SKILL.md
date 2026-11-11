---
name: quick-script
description: Usage guide for Nerve's `quick_script` tool (sandboxed scripts: Jira, Confluence, web, files, Office documents, images, diagrams).
---

# quick_script

Sandboxed TypeScript: ES module body with top-level `await`. No Node APIs, imports, JSX, network or filesystem. Only the globals listed in the tool description exist.

Output: `console.log` and a top-level `return value` (tables and JSON print compactly).

## Rules

- Methods take one argument: a bare string (key, id, JQL, CQL) or one options object. Exceptions: `files.*`, `image(...)`, `request(method, path, body?, query?)`.
- Filter early (JQL/CQL, `fields`, `limit`), then in code. Start with `await atlassian.defaults()` for site, project/space and user.
- Write only on explicit user request. The result footer lists `Created:` entities, artifacts and page lint.
- Failures throw `HostError` with `e.code`: `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `DENIED`, `RATE_LIMITED`, `UNAUTHORIZED`, `SERVER_ERROR`. A 401 stops the run; finished calls are not undone.
- The script is approved as a whole by its highest risk. Destructive methods are tagged `Destructive.` in the `.d.ts`; plan for the approval.

```ts
const issues = await jira.issues.search({
  jql: "project = APP AND statusCategory != Done",
  fields: ["summary", "status"],
  limit: 50,
});
return issues.map((i) => ({ key: i.key, status: i.status }));
```

## Files & documents

- Handles are `artifact:<name>` or workspace paths; XLSX, Papa, docx, mammoth, PptxGenJS, pptxText, image and diagram replace python/bash here.
- Read [files.md](references/files.md) and [files.d.ts](references/files.d.ts) for any file, Excel/CSV, Word, PowerPoint, image or diagram task.

## Jira

- Text is Markdown; JQL needs a restriction (`project = X AND ...`); issues and projects use `key`.
- Read [jira.d.ts](references/jira.d.ts) ([atlassian.d.ts](references/atlassian.d.ts) for `defaults`); [jira-workflows.md](references/jira-workflows.md) before creating or updating tickets; [jira-raw.md](references/jira-raw.md) when no method exists (changelog, sprints, rank…); [project-knowledge.md](references/project-knowledge.md) to save what you learned.

## Confluence

- Pages use `id`; bodies are storage XHTML built with `storage.*`. To edit, read `body: "storage"` and pass the `version` you read (`CONFLICT` if newer). Removing macros, layouts, images or mentions needs `allowRemoving: true`.
- CQL search lags after a create; use `pages.get({ title })` for exact titles.
- Read [confluence.d.ts](references/confluence.d.ts); [confluence-writing.md](references/confluence-writing.md) and [storage.md](references/storage.md) before writing a page; [confluence-raw.md](references/confluence-raw.md) when no method exists.

## Web

- `web.fetch(url)` returns HTML as markdown with a title, JSON parsed, other text as text; binary becomes `artifact:web-N.ext`. `as: "text" | "json" | "file"` and `name` override. `content` is the whole body (up to 8 MB): slice it before printing.
- `web.search` needs a Tavily account, else `DENIED` naming Settings → Tools → quick_script → Web. Both follow the `web_fetch` / `web_search` permission rules.
- Read [web.d.ts](references/web.d.ts).
