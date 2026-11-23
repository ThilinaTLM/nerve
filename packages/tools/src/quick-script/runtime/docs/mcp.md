# MCP servers

`mcp.*` reaches the MCP servers the user configured in `mcp.json` (user scope; the configure-nerve skill covers the file). Nerve starts or connects to a server on its first call and keeps it running for later scripts.

Find the tool, read its input schema, then call it:

```ts
const [tool] = await mcp.tools.search({
  query: "issue create",
  server: "github",
});
console.log(tool.name, JSON.stringify(tool.inputSchema));
const result = await mcp.tools.call({
  server: "github",
  tool: tool.name,
  arguments: { owner: "acme", repo: "web", title: "Login fails" },
});
console.log(result.text);
```

- `server` is the key in `mcp.json`; `mcp.servers.list()` shows each with its state and, once connected, the server's `instructions`.
- `result.text` joins the text blocks; many servers put JSON there, so `JSON.parse` it. `result.structured` holds a structured result when the tool returns one. Images and binary content are saved as artifacts (`result.files`).
- A tool that reports an error throws `SERVER_ERROR` with the tool's message. A server that cannot start throws `SERVER_ERROR` with the reason; `mcp.servers.list()` shows it as `failed`.
- Each `tools.call` is checked per tool, as operation `mcp.tools.call` with target `mcp:tool/<server>/<tool>`. Nerve cannot know what a tool does, so a script that calls one is approved as destructive. Call tools with literal `server` and `tool` values so the approval names them.
- Tools without `server` (`tools.list()`, `tools.search(query)`) cover every enabled server; a server that fails is skipped with a note in the result.
