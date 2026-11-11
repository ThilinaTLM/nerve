# Raw requests for what has no method

`jira.request(method, path, body?, query?)` and `confluence.request(...)`: the path is the full REST path (Jira `/rest/api/3/…` or `/rest/agile/1.0/…`, Confluence `/wiki/api/v2/…` or `/wiki/rest/api/…`); `query` is `{ name: value | value[] }` (the 4th argument, not part of the path). Returns JSON or text; a binary GET returns a `FileHandle`. Non-GET is destructive (approval). Jira rich-text bodies are ADF: build them with `jira.adf.fromMarkdown(md)`. Confluence bodies: `{ representation: "storage", value: storageXhtml }`.

## Jira

| Task                                  | Request                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changelog                             | `GET /rest/api/3/issue/{key}/changelog`                                                                                                                                 |
| Editable fields of an issue           | `GET /rest/api/3/issue/{key}/editmeta`                                                                                                                                  |
| Remote links                          | `GET` / `POST` `/rest/api/3/issue/{key}/remotelink`, `DELETE …/remotelink/{linkId}`                                                                                     |
| Priorities / resolutions / link types | `GET /rest/api/3/priority`, `/rest/api/3/resolution`, `/rest/api/3/issueLinkType`                                                                                       |
| Board backlog                         | `GET /rest/agile/1.0/board/{boardId}/backlog`                                                                                                                           |
| Sprint issues                         | `GET /rest/agile/1.0/sprint/{sprintId}/issue`                                                                                                                           |
| Create sprint                         | `POST /rest/agile/1.0/sprint` `{ name, originBoardId, goal?, startDate?, endDate? }`                                                                                    |
| Update / start / close sprint         | `POST /rest/agile/1.0/sprint/{sprintId}` partial: `{ name?, goal?, startDate?, endDate?, state?: "active" \| "closed" }`; starting needs state `future` plus both dates |
| Rank                                  | `PUT /rest/agile/1.0/issue/rank` `{ issues: [key], rankBeforeIssue: key }` (or `rankAfterIssue`)                                                                        |
| Update / delete worklog               | `PUT` / `DELETE /rest/api/3/issue/{key}/worklog/{id}`                                                                                                                   |
| Comment visibility                    | `PUT /rest/api/3/issue/{key}/comment/{id}` `{ body: adf, visibility: { type: "role", value: "Administrators" } }`                                                       |
| Delete attachment                     | `DELETE /rest/api/3/attachment/{id}`                                                                                                                                    |
| Delete link                           | `DELETE /rest/api/3/issueLink/{id}` (`issuelinks[].id` on `issues.get`)                                                                                                 |

## Confluence

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
