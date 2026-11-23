# MCP servers

An MCP (Model Context Protocol) server offers tools and resources of a service: GitHub, Linear, a database, a browser. Nerve connects to the servers in the user's `mcp.json` and agents reach them through `quick_script`'s `mcp` namespace; they never become separate tools.

Use one when the service publishes an MCP server and there is no CLI that already does the job.

## Procedure

1. Find the server's setup in its README: a command (stdio, often `npx -y <package>`) or a URL (Streamable HTTP).
2. Read `<home>/config/mcp.json` if it exists, back it up as described in the loop, and add the entry under `mcpServers`.
3. Credentials stay out of the file: reference an environment variable (`${GITHUB_TOKEN}`) and tell the user to set it where Nerve starts (their shell profile, then restart Nerve). Never write a token into the file.
4. `configuration.check("user")` reports invalid entries. Then try it: `await mcp.servers.list()` and `await mcp.tools.list("<name>")`. A server that cannot start says why (with its stderr).
5. Hand over: the entry you added, the variables the user must set, and that each tool call asks for approval until the user allows it (an "always allow" for one tool covers `mcp:tool/<server>/<tool>`).

## File

User scope only: `<home>/config/mcp.json`. Project files are not read. Nerve reads the file on every call, so no reload is needed; an edited entry reconnects on its next use.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" },
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
| `enabled`     | both       | `false` keeps the entry without connecting.                                                 |
| `timeout`     | both       | Seconds per request (default 120).                                                          |

`${NAME}` and `${NAME:-default}` are expanded in `command`, `args`, `env`, `cwd`, `url` and `headers` from Nerve's environment; an unset variable without a default makes that server fail with the variable's name. OAuth sign-in (`oauth`) is not supported: use a token in `headers`.

A stdio server runs once per project directory and stops after ten minutes unused.
