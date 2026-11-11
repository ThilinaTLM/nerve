# Jira requests for what has no method

`jira.request(method, path, body?, query?)`: the path is the full REST path (`/rest/api/3/…` or `/rest/agile/1.0/…`); `query` is `{ name: value | value[] }`, the 4th argument, not part of the path (GET: `jira.request("GET", "/rest/api/3/issue/APP-1/changelog", undefined, { maxResults: 20 })`). Returns JSON or text; a binary GET returns a `FileHandle`. Non-GET is destructive (approval). Rich-text bodies are ADF: build them with `jira.adf.fromMarkdown(md)`.

Typed methods cover issues, comments, worklogs, links, attachments, sprints and ranking; use raw requests only for the rest:

| Task                                  | Request                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Changelog                             | `GET /rest/api/3/issue/{key}/changelog`                                                                           |
| Editable fields of an issue           | `GET /rest/api/3/issue/{key}/editmeta`                                                                            |
| Remote links                          | `GET` / `POST` `/rest/api/3/issue/{key}/remotelink`, `DELETE …/remotelink/{linkId}`                               |
| Priorities / resolutions / link types | `GET /rest/api/3/priority`, `/rest/api/3/resolution`, `/rest/api/3/issueLinkType`                                 |
| Board backlog                         | `GET /rest/agile/1.0/board/{boardId}/backlog`                                                                     |
| Comment visibility                    | `PUT /rest/api/3/issue/{key}/comment/{id}` `{ body: adf, visibility: { type: "role", value: "Administrators" } }` |
