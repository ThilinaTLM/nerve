# Jira requests for what has no method

`jira.request(method, path, body?, query?)`: the path is the full REST path (`/rest/api/3/…` or `/rest/agile/1.0/…`); `query` is `{ name: value | value[] }` (the 4th argument, not part of the path). Returns JSON or text; a binary GET returns a `FileHandle`. Non-GET is destructive (approval). Rich-text bodies are ADF: build them with `jira.adf.fromMarkdown(md)`.

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
