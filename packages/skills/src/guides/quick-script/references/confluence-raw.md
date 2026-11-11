# Confluence requests for what has no method

`confluence.request(method, path, body?, query?)`: the path is the full REST path (`/wiki/api/v2/…` or `/wiki/rest/api/…`); `query` is `{ name: value | value[] }`, the 4th argument. Returns JSON or text; a binary GET returns a `FileHandle`. Non-GET is destructive (approval). Bodies: `{ representation: "storage", value: storageXhtml }`.

Typed methods cover pages, comments (footer and inline), labels and attachments; use raw only for the rest:

| Task                  | Request                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page restrictions     | `GET /wiki/rest/api/content/{id}/restriction/byOperation`                                                                                                                                  |
| Rename an attachment  | `PUT /wiki/rest/api/content/{attachmentId}` `{ id, type: "attachment", title: newName, version: { number: n + 1 } }`                                                                       |
| Page versions         | `GET /wiki/api/v2/pages/{id}/versions`                                                                                                                                                     |

## Restrictions recipe

Operations are `read` and `update`; users are addressed by `accountId` (find it with `atlassian.users.search` or from a comment `author`).

```ts
const id = "123";
const base = `/wiki/rest/api/content/${id}/restriction/byOperation`;
const current = await confluence.request("GET", base); // who is restricted now
await confluence.request("PUT", `${base}/update/user`, undefined, {
  accountId: "…",
}); // add a user
await confluence.request("DELETE", `${base}/update/user`, undefined, {
  accountId: "…",
}); // remove a user
await confluence.request("PUT", `${base}/read/byGroupId/${groupId}`); // add a group
```

A restricted operation with no subjects left is unrestricted again.
