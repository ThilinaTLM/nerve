# `confluence.*`

All methods are async. Page ids may be passed bare or as an object using aliases `id`, `pageId`, `page_id`, `page`. Page bodies read back as Markdown by default; write bodies as Markdown or Confluence storage XHTML (see "Body formats").

## Page style

TODO: best practices for page structure and style (to be filled in).

## Body formats

- `format: "markdown"` converts the body to storage XHTML before sending.
- `format: "storage"` sends XHTML as is, after expanding any `storage.markdown()` placeholders (see [storage.md](storage.md)).
- Omitted `format`: `"storage"` if the body contains `storage.*` helper output, otherwise `"markdown"`. Any other value throws.

## Page shape

`{ id, title, url, version }` is returned by create/update. `pages.get` adds `space`, `parentId`, `labels`, `body`, `children?`.

## `confluence.spaces.search(query?)`

`query` is a string or `{ query }`; case-insensitive "contains" on space key or name; empty returns all (scans up to 2500 spaces). Returns `{ id, key, name, type, url }[]`.

## `confluence.pages.search({ cql?, space?, title?, limit? })`

Also `search("cql")`. Conditions are ANDed: `cql` (wrapped in parentheses), `space` (alias `spaceKey`, equals), `title` (contains). With no `cql` it searches `type = page`; at least one of `cql`, `space`, `title` is required. `limit` defaults to 25, max 250. Returns `{ id, title, space, url, updated, parentId }[]`.

## `confluence.pages.get(id | { space, title }, { body?, children? })`

Look up by id, or by exact `{ space?, title }` (space defaults to the configured one; throws if no page matches). Options may also be in the first object.

- `body`: `"markdown"` (default), `"storage"` (raw XHTML), or `false` (omit the body).
- `children: true` adds `children: { id, title }[]` (direct children, first 100).

Returns `{ id, title, space, url, version, parentId, labels: string[], body?, children? }`; `space` is the key.

## `confluence.pages.create({ space, title, parent?, body, format? })`

Creates a page. `space` (alias `spaceKey`) may be omitted to use the configured default; `parent` is a parent page id; `body` must be non-empty. Returns `{ id, title, url, version }`.

## `confluence.pages.update(id, { title?, body?, format?, message? })`

Provide `title` and/or `body`. The body is replaced wholesale (read it first and edit in code when making partial changes); an omitted body or title keeps the current one. The version is bumped for you; `message` is the version comment. Returns `{ id, title, url, version }`.

## `confluence.labels.add(pageId, labels)`

`labels` is a string or string[] (also `{ labels }` / `{ label }` in options). Adds global labels; returns `{ id, labels }` with the labels you added.

## `confluence.comments.add(pageId, body, { format? })`

Adds a footer comment (not inline). `body` is a non-empty string (or `{ body }` in options); `format` as above. Returns `{ id, pageId }`.
