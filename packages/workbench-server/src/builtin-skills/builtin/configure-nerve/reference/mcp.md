# MCP servers

An MCP (Model Context Protocol) server offers tools and resources of a service: GitHub, Linear, a database, a browser. Nerve connects to the servers in `mcp.json` and agents reach them through `quick_script`'s `mcp` namespace; they never become separate tools.

Use one when the service publishes an MCP server and there is no CLI that already does the job.

## Procedure

1. Find the server's setup in its README: a command (stdio, often `npx -y <package>`) or a URL (Streamable HTTP).
2. Pick the file. A personal server goes in `<home>/config/mcp.json`; one the team shares goes in `<project>/.nerve/config/mcp.json`. Read the file if it exists, back it up as described in the loop, and add the entry under `mcpServers`.
3. Never write a token into the file. Reference an environment variable (`${GITHUB_TOKEN}`) the user sets where Nerve starts, or a secret (`${secret:github-token}`) and ask the user to add it in Settings (see Secrets).
4. `configuration.check("user")` (or `("project")` for a project file) reports invalid entries and entries waiting for approval.
5. Hand over: the entry you added, where the user approves it, the variables or secrets the user must set, and that each tool call asks for approval until the user allows it (an "always allow" for one tool covers `mcp:tool/<server>/<tool>`).

## Approval

An entry does not start, connect or show its tools until the user approved that exact entry, in both files. You cannot approve it. After you write or change an entry, tell the user it waits for review in **User settings → Connections → MCP servers** (user file) or **Project settings → Agent → MCP servers** (project file), then stop: `mcp.servers.list()` shows `needs_review`, and calls fail with `FORBIDDEN` until the user acts. Retrying does not help. Any change to an entry asks again; entries the user saves in Settings are approved already.

## Files and precedence

| File    | Path                               | Shared through |
| ------- | ---------------------------------- | -------------- |
| User    | `<home>/config/mcp.json`           | Nobody         |
| Project | `<project>/.nerve/config/mcp.json` | The repository |

Only these files are read, not `.mcp.json` or `.vscode/mcp.json`; copy an entry over. The same name in both files: the approved project entry replaces the user entry whole (fields never merge). While the project entry waits for review the user entry keeps working. Nerve reads the files on every call, so no reload is needed; an edited entry asks for approval again and reconnects on its next use.

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

| Field         | Applies to | Meaning                                                                                     |
| ------------- | ---------- | ------------------------------------------------------------------------------------------- |
| key           | both       | The server name scripts use: letters, digits, `_` and `-`.                                  |
| `command`     | stdio      | Program to start. It inherits Nerve's environment.                                          |
| `args`        | stdio      | Arguments.                                                                                  |
| `env`         | stdio      | Added to the environment.                                                                   |
| `cwd`         | stdio      | Working directory; relative paths and the default are the conversation's project directory. |
| `url`         | http       | Streamable HTTP endpoint. Legacy SSE servers are not supported.                             |
| `headers`     | http       | Sent with every request.                                                                    |
| `description` | both       | One line on what the server offers; shown by `mcp.servers.list()`.                          |
| `enabled`     | both       | The entry's own default (`false`: off). Agent settings above it decide first.               |
| `timeout`     | both       | Seconds per request (default 120).                                                          |

## Variables and secrets

`${NAME}` and `${NAME:-default}` are expanded in `command`, `args`, `env`, `cwd`, `url` and `headers` from Nerve's environment; an unset variable without a default makes that server fail with the variable's name. The review lists every variable and secret an entry references and where its value goes, so name only what the server needs.

`${secret:<name>}` reads a value the user stored in Nerve's credential vault: user secrets for the user file, the project's own secrets for the project file (a project entry cannot read the user's). You cannot read, write or list secrets. Ask the user to add the secret in the same settings page as the server (User settings → Connections → MCP servers, or Project settings → Agent → MCP servers); a server whose secret is unset fails and names it.

OAuth sign-in (`oauth`) is not supported yet: use a token in `headers`.

## Turning servers on and off

The agent settings (`agent.json`, user or project scope, and a conversation) hold `mcpServers`, resolved per server name like skills; the highest layer that decides wins and a named entry beats `defaults`:

```json
{
  "overrides": {
    "mcpServers": { "defaults": true, "servers": { "github": false } }
  }
}
```

A server no layer decides follows the entry's own `enabled` (default on). Profiles can list `mcpServers.servers` in `requirements` or `recommendations`. A project `agent.json` toggle is shared through the repository and needs the user's approval like the rest of that file. Off wins over approval: a server turned off is not started and `mcp.servers.list()` says `disabled`.

A stdio server runs once per project directory and stops after ten minutes unused.
