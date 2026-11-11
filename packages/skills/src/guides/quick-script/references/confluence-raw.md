# Confluence requests for what has no method

`confluence.request(method, path, body?, query?)`: the path is the full REST path (`/wiki/api/v2/…` or `/wiki/rest/api/…`); `query` is `{ name: value | value[] }` (the 4th argument, not part of the path). Returns JSON or text; a binary GET returns a `FileHandle`. Non-GET is destructive (approval). Bodies: `{ representation: "storage", value: storageXhtml }`.

| Task                               | Request                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Footer / inline comments of a page | `GET /wiki/api/v2/pages/{id}/footer-comments`, `…/inline-comments` (add `query: { "body-format": "storage" }` for text)                                                                    |
| Create inline comment              | `POST /wiki/api/v2/inline-comments` `{ pageId, body: { representation: "storage", value }, inlineCommentProperties: { textSelection, textSelectionMatchCount, textSelectionMatchIndex } }` |
| Update comment                     | `PUT /wiki/api/v2/footer-comments/{id}` or `inline-comments/{id}` `{ version: { number: n + 1 }, body }`                                                                                   |
| Resolve inline comment             | `PUT /wiki/api/v2/inline-comments/{id}` `{ version: { number: n + 1 }, resolved: true }`                                                                                                   |
| Delete comment                     | `DELETE /wiki/api/v2/footer-comments/{id}` or `inline-comments/{id}`                                                                                                                       |
| Trash page                         | `DELETE /wiki/api/v2/pages/{id}`                                                                                                                                                           |
| Purge trashed page                 | `DELETE /wiki/api/v2/pages/{id}` with `query: { purge: true }`                                                                                                                             |
| Restore trashed page               | `PUT /wiki/api/v2/pages/{id}` `{ id, status: "current", title, version: { number: n + 1 }, body }` (body is not applied)                                                                   |
| Remove label                       | `DELETE /wiki/rest/api/content/{id}/label/{label}`                                                                                                                                         |
| Restrictions                       | `GET /wiki/rest/api/content/{id}/restriction/byOperation`                                                                                                                                  |
| Move under a parent                | `PUT /wiki/rest/api/content/{id}/move/append/{targetId}`                                                                                                                                   |
| Versions                           | `GET /wiki/api/v2/pages/{id}/versions`                                                                                                                                                     |
