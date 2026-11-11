# `jira.*`

All methods are async and take **one argument**: a bare string when only the id (or the main query) is needed — `jira.issues.get("APP-1")` — or one options object that holds the id under its single name — `jira.issues.get({ key: "APP-1", comments: true })`. Issues and projects use `key`. There are no aliases and no second argument: an unknown option or an extra argument throws and lists the valid options. The one exception is `jira.request(method, path, body?)`, which mirrors an HTTP call.

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

A bare string is the JQL: `search("project = APP")`. Returns `Issue[]`. `limit` defaults to 50, clamped to 1–1000; pages are followed for you. JQL must be bounded (field restriction); bare `ORDER BY` is rejected.

## `jira.issues.get({ key, fields?, comments? })`

Bare string = the key. Returns `Issue` including `description`. `comments: true` adds `comments: { author, created, body }[]` (up to 1000, oldest first).

## `jira.projects.get({ key })`

Bare string = the key. Returns `{ key, name, lead, issueTypes, components, versions }`; `lead` is `{ name, email, accountId } | null`, the rest are name strings.

## `jira.users.search({ query })`

Bare string = the query. Returns up to 50 `{ accountId, name, email, active }[]`.

## `jira.fields.list()`

Returns every field `{ id, name, custom, type }[]` (`type` is the schema type or null). Cached per script run.

## `jira.request(method, path, body?)`

Raw REST call for anything the methods above do not cover. `method` is `GET`, `POST`, `PUT`, `PATCH` or `DELETE`; `path` is relative to the site and must start with `/rest/api/3/` (platform) or `/rest/agile/1.0/` (boards, sprints); absolute URLs and other paths are rejected. `body` is sent as JSON. Returns the parsed JSON (or the text when it is not JSON; `null` when empty); responses over 5 MB throw, so narrow the request. `GET` is permission-checked like a read, any other method like a destructive Jira write.

## Errors

Failures throw `HostError` with a `code` for the cases worth handling: `FORBIDDEN` (HTTP 403, message names the resource, e.g. `no access to project APP`), `NOT_FOUND`, `BAD_REQUEST` (JQL errors pass Jira's message through), `DENIED` (permission policy). An invalid token (HTTP 401) is different: the whole script stops with one message naming the account, and no further calls run.
