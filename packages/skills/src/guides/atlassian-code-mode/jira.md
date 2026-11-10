# `jira.*`

All methods are async. Identifier arguments accept the bare string or an object using an alias, optionally followed by an options object: `jira.issues.get("APP-1", { comments: true })` ≡ `jira.issues.get({ key: "APP-1", comments: true })`.

## Issue shape

```
{ key, id, url, summary, status, statusCategory, type, priority,
  assignee, reporter,            // { name, email, accountId } | null
  created, updated, resolution, labels, components, fixVersions,
  parent,                        // { key, summary } | null
  description,                   // Markdown; issues.get default only, or if requested
  ...requested fields }          // keyed by the name you passed
```

Notes:

- `fields` is an array of names or ids. Standard names are case-insensitive and have aliases (`type`/`issue type`, `fix versions`, `links`, `comments`, `attachments`, `worklogs`, `time tracking`). Custom fields by name (`"Story Points"`) or `customfield_123`. Unknown or ambiguous names throw; use `jira.fields.list()`.
- Default fields: all of the standard shape above (`description` only for `issues.get`).
- Opt-in structured fields, simplified when requested: `comment` → `{ author, created, body }[]`; `attachment` → `{ id, filename, size, mimeType }[]`; `issuelinks` → `{ type, direction, key, summary }[]`; `subtasks` → `{ key, summary, status }[]`; `worklog` → `{ author, started, timeSpent, timeSpentSeconds, comment }[]`; `timetracking` → estimates and seconds.
- Custom field values are simplified: options → string (`"A / B"` for cascading), users → display name, ADF → Markdown.

## `jira.issues.search({ jql, fields?, limit? })`

Also `search("jql", { fields?, limit? })`. Returns `Issue[]`. `limit` defaults to 50, clamped to 1–1000; pages are followed for you. JQL must be bounded (field restriction); bare `ORDER BY` is rejected.

## `jira.issues.get(key, { fields?, comments? })`

Key aliases: `key`, `issueKey`, `issueIdOrKey`, `issueId`, `id`. Returns `Issue` including `description`. `comments: true` adds `comments: { author, created, body }[]` (up to 1000, oldest first).

## `jira.projects.get(key)`

Key aliases: `key`, `projectKey`, `projectIdOrKey`, `project`, `id`. Returns `{ key, name, lead, issueTypes, components, versions }`; `lead` is `{ name, email, accountId } | null`, the rest are name strings.

## `jira.users.search(query)`

`query` is a string, or an object with `query`/`name`/`email`. Returns up to 50 `{ accountId, name, email, active }[]`.

## `jira.fields.list()`

Returns every field `{ id, name, custom, type }[]` (`type` is the schema type or null). Cached per script run.
