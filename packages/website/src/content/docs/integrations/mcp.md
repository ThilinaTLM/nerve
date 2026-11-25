---
title: MCP servers
description: Connect Model Context Protocol servers in Settings or mcp.json, review them, and let agents use their tools and resources through Quick script.
sidebar:
  order: 1.5
---

[MCP](https://modelcontextprotocol.io/) (Model Context Protocol) servers expose the tools and resources of a service, such as GitHub, Linear, a database, or a browser. Nerve connects to the servers you configure and the agent reaches them only through [Quick script](/guides/quick-script/), in the `mcp` namespace. A server's tools never become separate agent tools, so adding a server doesn't change the tool list or add to the prompt.

Use an MCP server when a service publishes one and no command-line tool already does the job.

<!-- screenshot: mcp-servers -->

## Add a server

Open **Settings → MCP servers** and choose **Add MCP server**.

1. Enter a **Name** (letters, digits, `_` and `-`). Scripts use it to refer to the server.
2. Choose **Available to**: **User** (every project, stored in your Nerve home) or **This project** (stored in the project and shared through the repository). The project choice needs an open project.
3. Choose the type: **Local command** (stdio: command, arguments, optional working directory, environment variables) or **HTTP URL** (Streamable HTTP: URL and headers). **Paste JSON** accepts an entry copied from a server's README.
4. Optionally add a description and a request timeout in seconds.

A secret value, such as a token in an environment variable or header, is stored in Nerve's credential vault on your computer. The file keeps only a `${secret:name}` reference. Entries you save here are trusted already.

A server's page shows where it is defined, whether you trust it, and its **Tools** after a connection test. Remove deletes the entry, its approval and its stored secrets.

The agent can add entries too. Ask in a [Forge conversation](/guides/configure-by-chat/) and it writes the file; you then review the entry yourself.

## The configuration file

Settings edits two files. You can also edit them directly.

| File    | Path                                                | Shared through |
| ------- | --------------------------------------------------- | -------------- |
| User    | `<NERVE_HOME>/config/mcp.json` (default `~/.nerve`) | Nobody         |
| Project | `<project>/.nerve/config/mcp.json`                  | The repository |

Nerve reads these files, not `.mcp.json` or `.vscode/mcp.json`; copy an entry over. They use the `mcpServers` shape other MCP clients share, and Nerve reads them on every call, so an edit applies to the next call without a reload. If a project entry has the same name as a user entry, the trusted project entry replaces the user entry as a whole; while the project entry waits for review, the user entry keeps working.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${secret:github-token}" },
      "description": "Issues and pull requests on github.com"
    },
    "docs": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "timeout": 60
    }
  }
}
```

| Field         | Applies to | Meaning                                                                                |
| ------------- | ---------- | -------------------------------------------------------------------------------------- |
| `command`     | stdio      | Program to start. It inherits Nerve's environment.                                     |
| `args`        | stdio      | Arguments.                                                                             |
| `env`         | stdio      | Variables added to the environment.                                                    |
| `cwd`         | stdio      | Working directory. Relative paths and the default are the project directory.           |
| `url`         | HTTP       | Streamable HTTP endpoint. Legacy SSE servers aren't supported.                         |
| `headers`     | HTTP       | Sent with every request.                                                               |
| `description` | both       | One line about what the server offers.                                                 |
| `enabled`     | both       | The entry's own default; `false` turns it off. Your switches in Settings decide first. |
| `timeout`     | both       | Seconds per request. Default 120.                                                      |

### Variables and secrets

`${NAME}` and `${NAME:-default}` are expanded in `command`, `args`, `env`, `cwd`, `url` and `headers` from the environment Nerve was started with. A variable that is unset and has no default makes that server fail, and the error names the variable. `${secret:name}` reads a secret you stored in Settings: user entries read your secrets, project entries read the project's own. Don't write tokens into the file, especially a project file that is committed.

OAuth sign-in for MCP servers isn't supported. Pass a token in `headers` instead.

## Review and trust

An MCP server can start a program or send data to a URL, so an entry doesn't connect until you trust that exact entry. The same three states apply as for other project files: **Needs review**, **Trusted**, and **Declined**. The review lists the command or URL, every variable and secret the entry references, and where each value goes. Changing an entry in an editor asks again; saving it in Settings keeps it trusted.

Servers waiting for review appear in the notification bell and as a count beside **MCP servers** in Settings. Until you decide, scripts that name the server fail with `FORBIDDEN`. See [Settings at a glance](/guides/settings/#project-files-you-review).

## Turn servers on and off

Each server row in Settings has a **User** switch and, when a project is open, a project switch. A server that is switched off isn't started. Servers that no switch decides follow the entry's `enabled` field, which defaults to on. A [profile](/reference/agent-profiles/) can recommend or require servers too.

## How agents use them

The `mcp` namespace appears in Quick script's description only while at least one server is on, so it costs nothing when unused.

```ts
await mcp.servers.list(); // state, scope, instructions
await mcp.tools.search({ query: "create issue", server: "github" });
await mcp.tools.get({ server: "github", tool: "create_issue" }); // inputSchema
await mcp.tools.call({
  server: "github",
  tool: "create_issue",
  arguments: { owner: "acme", repo: "web", title: "Login fails" },
});
await mcp.resources.list("docs");
await mcp.resources.get({ server: "docs", uri: "docs://readme" });
```

- A server starts or connects on first use and is shared by later scripts. A stdio server runs once per project directory and closes after ten minutes unused. A dropped connection is re-established on the next call.
- A call returns `text` (text blocks joined), `structured` when the tool returns a structured result, and `files` for images, audio and binary content, which are saved as conversation artifacts. A tool that reports an error makes the script fail with `SERVER_ERROR`.
- A server's state is `connected`, `idle`, `failed`, `disabled`, `needs_review` or `declined`. Start failures include the end of the server's error output.
- After a timeout the tool may still have run, so check its effect before calling it again.

### Permissions

Nerve can't know what an MCP tool does, so calling one counts as **destructive** and a script that does so asks for approval under Supervised permission. Each call is checked as the operation `mcp.tools.call` on the target `mcp:tool/<server>/<tool>`. When the script names the server and tool literally, **Allow in this conversation** and **Always approve** cover that one tool; the arguments can still be computed. Listing tools, searching, and reading resources are external reads on `mcp:server/<name>`, and a deny rule on a server applies to them. You can write [permission rules](/guides/agent-controls/) against these targets.

Starting a configured stdio server isn't checked as a Bash command: you trust the entry when you review it.

## Next steps

- [Batch work with Quick script](/guides/quick-script/)
- [Extensions](/integrations/extensions/)
- [Configure Nerve by chat](/guides/configure-by-chat/)
