# MCP servers

`mcp.*` reaches the MCP servers the user configured, in their `mcp.json` or the project's (the configure-nerve skill covers the file). Nerve starts or connects to a server on its first call and keeps it running for later scripts.

Start with `tools.search(query)`: it ranks the tools of every server and returns short matches. Read the full schema with `tools.get` only when the `arguments` line is not enough, then call:

```ts
const matches = await mcp.tools.search("create issue");
console.log(matches);
// [{ server: "github", name: "create_issue", summary: "Create a new issue in a repository.",
//    arguments: "owner: string, repo: string, title: string, body?: string" }, ...]
const result = await mcp.tools.call({
  server: "github",
  tool: "create_issue",
  arguments: { owner: "acme", repo: "web", title: "Login fails" },
});
console.log(result.text);
```

- `tools.search` needs every word of the query to match the server name, or a tool's name, title or description (a tool name match ranks first). `limit` defaults to 10 (max 50); when more match, a note gives the total, so narrow the query or pass `server`. In `arguments`, `?` marks an optional field; read `mcp.tools.get({ server, tool })` for nested or unclear fields.
- `server` is the key in `mcp.json`; `mcp.servers.list()` shows each with its `scope` (`user` or `project`), its state and, once connected, the server's `instructions` about its tools. A project entry waiting for review can share its name with a user entry that works: the waiting row has `duplicate: true`, and calls by that name reach the user's entry.
- `result.text` joins the text blocks; many servers put JSON there, so `JSON.parse` it. `result.structured` holds a structured result when the tool returns one. Images and binary content are saved as artifacts (`result.files`).
- A tool that reports an error throws `SERVER_ERROR` with the tool's message. A server that cannot start throws `SERVER_ERROR` with the reason; `mcp.servers.list()` shows it as `failed`. After a timeout the tool may still have run: check its effect before calling it again.
- Each `tools.call` is checked per tool, as operation `mcp.tools.call` with target `mcp:tool/<server>/<tool>`. Nerve cannot know what a tool does, so a script that calls one is approved as destructive. With literal `server` and `tool` (the `arguments` may be computed) the approval names the tool and the user can allow it for good; otherwise every such script asks again.
- `state` is `connected`, `idle` (connects on first use), `failed`, `disabled` (turned off in settings or by `enabled: false`), `needs_review` (the user has not reviewed the entry) or `declined` (the user declined it; mention it only if it matters for the task). The last three never start, and calling them throws `FORBIDDEN` naming where the user acts (User settings → Connections → MCP servers, or Project settings → Agent → MCP servers). Tell the user; you cannot enable or approve a server yourself.
- Listings without `server` (`tools.list()`, `tools.search(query)`, `resources.list()`) cover every connected, idle or failed server; disabled, unreviewed and declined servers, servers that are not allowed and servers that fail are skipped with a note in the result.
