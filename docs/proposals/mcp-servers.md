# MCP servers: settings, project servers, consent, tool search

Status: the agent side for user-level servers is implemented in [#636](https://github.com/ThilinaTLM/nerve/pull/636). Project-level servers, consent, the Settings pages and tool search are proposed here. Delete this file when everything is implemented (see [docs/README.md](../README.md#where-documentation-belongs)).

## Problem

Nerve can use MCP servers, but only those in the user's `<home>/config/mcp.json`. Three gaps remain:

1. **Configuration is file-only.** Adding a server means editing JSON by hand or asking the agent to do it. Tokens end up as `${VAR}` references to an environment the user has to set up and restart Nerve for, or as plain text in the file.
2. **No project servers.** A team cannot share "this repository uses the Linear and Postgres servers". A project file would start programs a repository defines, so it needs consent, and Nerve has no consent for MCP yet.
3. **User entries run unreviewed.** An agent that edits the user's `mcp.json` (an approved file write) can add a stdio command that later starts without being checked as a command. It can also add a `${VAR}` that sends any daemon environment variable to any URL.

There is also a cost for the agent. Finding a tool across servers means `mcp.tools.search(query)`, which starts every server on every search, returns every match with its full input schema, and does not rank results.

## Goals

- A Settings page to add, edit, test, enable and remove MCP servers at user scope and at project scope.
- Project servers, shared through the repository, used only after the user approves each one.
- One consent rule for both scopes: no server starts or connects until the user has approved its exact entry. Entries the user saves in Settings count as approved.
- Secrets for MCP servers stored in Nerve's credential vault, not in `mcp.json`.
- One fast, ranked search over the tools of every server the agent may use, without starting them.

## Non-goals

- MCP tools as direct tools. They stay in `quick_script`'s `mcp` namespace ([code mode](../architecture/code-mode.md)).
- OAuth sign-in (see [Later](#later)).
- MCP sampling, elicitation and prompts.
- A server catalog or registry browser.

## Implemented (#636)

| Area             | What exists                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration    | `<home>/config/mcp.json` in the shared `mcpServers` shape: stdio (`command`, `args`, `env`, `cwd`), Streamable HTTP (`url`, `headers`), and `description`, `enabled`, `timeout`. Validated with pi-mcp's `validateMcpServerConfig`; unknown fields and `oauth` are rejected per entry. `${VAR}` and `${VAR:-default}` come from the daemon's environment. Read on every call ([`mcp-config.ts`](../../packages/workbench-server/src/domains/mcp/mcp-config.ts)). |
| Connections      | [`McpServerHub`](../../packages/workbench-server/src/domains/mcp/mcp-server-hub.ts) uses the `@earendil-works/pi-mcp` client and connects on first use. stdio servers run per project directory (their `cwd` and root). Connections close after 10 idle minutes and at shutdown, and reconnect after a crash or an expired session.                                                                                                                              |
| Agent surface    | The built-in `mcp` namespace: `servers.list`, `tools.list/search/get/call` and `resources.list/get`. The description lists it only while an enabled server exists (`listedWhenConfigured`). Results are `{ text, structured?, files? }`, with binary content saved as artifacts.                                                                                                                                                                                 |
| Permissions      | `tools.call` is destructive, with target `mcp:tool/<server>/<tool>`. Listings and reads are `external_read` on `mcp:server/<name>`. `scanOptions` lets the scan name the tool when `arguments` are computed. A listing without a server is checked per server.                                                                                                                                                                                                   |
| Health and skill | The `mcp-servers` configuration resource reports invalid entries to `configuration.check("user")` and the attention list. configure-nerve has `reference/mcp.md`.                                                                                                                                                                                                                                                                                                |

## Design

### Files and precedence

| Scope   | File                               | Shared through |
| ------- | ---------------------------------- | -------------- |
| User    | `<home>/config/mcp.json`           | Nobody         |
| Project | `<project>/.nerve/config/mcp.json` | The repository |

The project file sits next to the project's `permissions.json` and `agent.json`, and is resolved by the same `projectConfigurationRoot`.

- **Same name: the project entry wins, whole, like skills and profiles.** A project entry replaces a user entry of the same name only while it is approved. Until then the user's entry keeps working, and `servers.list()` reports the project one as waiting.
- **Overrides that only narrow need no approval.** A project entry with neither `command` nor `url` (pi-mcp's `isMcpServerOverride`) may only set `enabled: false`. It turns a user server off in that project and starts nothing. Any other field in an override is invalid.
- **No merging of fields** between scopes, apart from that override.

### Consent

One new trust kind, `mcp_server`, in the existing `trusted_resource` table ([trust](../architecture/trust.md)). No table rebuild and no schema change.

| Column           | Value                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `project_id`     | The project for a project entry; `NULL` for a user entry                                                                          |
| `resource_key`   | The server name                                                                                                                   |
| `content_digest` | `sha256` of the entry as written (canonical JSON, variables **not** expanded), plus its scope                                     |
| `grants`         | Snapshot shown in the review: transport, command and args or URL, `cwd`, and the names of the variables and secrets it references |

Rules:

1. **Nothing connects before consent.** A pending entry is not started, not connected and not indexed, and its tools are not listed. `servers.list()` shows it as `needs_approval`. A call to it fails with `FORBIDDEN` and names where the user approves it. The agent cannot approve (trust rule 3).
2. **Per entry, not per file.** Adding a server to a file does not invalidate the other entries, and editing one entry asks again only for that one.
3. **Any change to the entry asks again.** Changes to variable or secret _values_ do not: the digest covers the entry as written, not its expansion.
4. **Saving in Settings approves.** When the user saves an entry in Settings, the server records the digest of what it wrote. The user wrote it, so there is nothing to review. Entries written any other way (by hand, by the agent, by `git pull`) wait for review.
5. **The review says what can leave the machine.** It shows the command line or URL and the working directory. It lists every `${VAR}` and secret the entry references, with where each value goes (environment of the process, or a header to the URL): "Sends `OPENAI_API_KEY` to `https://example.com` in header `Authorization`". Values are never shown.
6. **Rejecting** keeps the row as `rejected`. The server stays off until approved, and Settings shows it as rejected.

This also closes the user-scope gap from #636. Because #636 is unreleased, user entries become pending without a migration. If it ships first, the migration step of that release approves the user entries that exist at upgrade.

### Secrets

Values the user enters as secret are stored in the credential vault ([`SecretProvider`](../../packages/workbench-server/src/infrastructure/secrets/index.ts), `secrets/credentials.enc`) and referenced from the file as `${secret:<name>}`.

- **Scoped names.** User secrets are `mcp:user:<name>`. Project secrets are `mcp:project:<projectId>:<name>`; they live on this machine only and never in the repository.
- **Reach.** A user entry can reference user secrets. A project entry can reference that project's secrets only, so a repository cannot ask for the user's personal tokens by name. It can still reference environment variables, which the review lists (rule 5).
- **Unset secret.** That server fails, with an error naming the secret and the page where it is set.
- **No agent surface** reads, writes or lists secret values. `servers.list()` and the agent's errors name secrets, never values.

### Settings pages

**User settings → Connections → MCP servers** (next to Providers, Extensions, Accounts) and **Project settings → Agent → MCP servers**. Both are one component that takes the scope.

| Part        | Content                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List        | Name, description, transport and state (`connected`, `idle`, `failed` with the reason, `disabled`, `needs approval`, `rejected`). Once indexed: tool count. The project page also lists the user's servers it inherits, marked "from your settings", with the project's override.                                      |
| Row actions | Enable/disable, Test, Edit, Remove, Disconnect (a running connection). On the project page, a pending entry shows **Review** instead of Edit.                                                                                                                                                                          |
| Add / Edit  | A form: name; stdio (command, args, env, cwd) or HTTP (URL, headers); timeout; description. Each env or header value can be marked secret, which saves it to the vault. **Paste JSON** accepts an `mcpServers` snippet as server READMEs show it and fills the form. An **Edit JSON** mode shows the entry as written. |
| Test        | Connects (starting a stdio server) and shows server name and version, instructions, tools and resources, or the error with the stderr tail. Test on a pending entry is not offered: review first.                                                                                                                      |
| Detail      | What the agent sees: each tool with its description and input schema, resources, and the server's instructions.                                                                                                                                                                                                        |
| Review      | The rule-5 view, with Approve and Reject. Pending project entries also appear on **This project → Trust**, and in the attention list through the `mcp-servers` resource (`needs_approval` per entry).                                                                                                                  |

Saving goes through the server, never through the app writing the file. Saving validates (the same `parseMcpConfig`), writes the file atomically with two-space JSON, stores secrets and records the approval. Comments and unknown top-level fields are not supported, so nothing is lost on rewrite. A file that is invalid on disk is shown with its problems and is not overwritten until the user chooses **Replace with a valid file**, or fixes it by hand.

New operations in `contracts` (user-UI only, not reachable from the agent):

| Operation                | Purpose                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `mcp.servers.list`       | Entries of a scope, with state, review status and inherited entries           |
| `mcp.servers.save`       | Create or update one entry (with secret values), approve it, return the entry |
| `mcp.servers.remove`     | Remove an entry, its secrets and its approval                                 |
| `mcp.servers.test`       | Connect and return server info, tools and resources, or the error             |
| `mcp.servers.disconnect` | Close a running connection                                                    |
| `mcp.servers.review`     | The rule-5 view of a pending entry                                            |

Approve and reject use the existing `trust.decide`. A `mcp.changed` event refreshes open pages and the hub after any change, including approvals.

### Agent surface changes

Every change follows [agent-facing content](../agent-facing.md).

- **`servers.list()`** gains `scope: "user" | "project"` and the states `needs_approval` and `rejected`. `error` says where the user acts: "Waiting for your approval in Project settings → MCP servers". Still no command, URL, header or environment value.
- **Calls to a pending, rejected or disabled server** fail with `FORBIDDEN` (not `NOT_FOUND`), naming the state and the page. A retry does not help until the user acts, and the agent should tell the user so.
- **The description line** stays cache-stable. It lists method names only; server names and tools stay out, because they change with the project and with consent. The namespace stays listed while at least one server is enabled at either scope.
- **configure-nerve.** `reference/mcp.md` gains the project file, precedence, overrides and the approval hand-over. The agent writes a project entry, then reports that it waits for review in Project settings → MCP servers. Secrets: the agent never writes a token; it asks the user to add it as a secret in Settings.
- **Server text is data.** Tool descriptions, instructions and resource contents come from the server. Search results and `servers.list()` keep them in their own fields and never merge them into Nerve's own text.

### Tool search across servers

`mcp.tools.search` already takes a query without a server, so it stays the one method for this. A second method for the same idea would split agents between two names. It changes in four ways:

1. **An index, not a connection per search.** The hub keeps each server's `tools/list` result in an index. The index is filled on connect, refreshed on `notifications/tools/list_changed`, and stored in `<home>/cache/mcp/<key-hash>.json`. The key is the resolved entry's digest, so a changed entry gets a fresh index and a restart keeps the old one. A search reads the index. A server that is approved but not yet indexed is connected once, with up to four in parallel. Servers that are pending, rejected, disabled or refused by policy are skipped, with a note.
2. **Ranked.** The query is split into words, and names are split on `_`, `-` and camelCase. A word that matches the tool name scores above a title match, and a title match scores above a description match. Exact words score above prefixes. Every query word must match somewhere. Results are best first, with ties ordered by server and then tool name.
3. **Compact results.** A new `McpToolMatch` type: `{ server, name, title?, summary, arguments }`.
   - `summary` is the description's first sentence, at most 200 characters.
   - `arguments` is a one-line rendering of the input schema, such as `owner: string, repo: string, title: string, body?: string, labels?: string[]`.
   - Often that is enough to write the call. `tools.get` still returns the full schema when the arguments are nested or unclear.
4. **Bounded.** `limit` defaults to 10, with a maximum of 50. When the limit cuts the result, a footer note names the limit and the total, following the namespace conventions. The signature says `limit default 10, max 50`. With `server`, the search covers that server only.

```ts
const matches = await mcp.tools.search("create issue");
// [{ server: "github", name: "create_issue", summary: "Create a new issue in a repository.",
//    arguments: "owner: string, repo: string, title: string, body?: string" }, ...]
```

- **Risk.** It stays `external_read`, because it may connect to a server that is not yet indexed. Without `server`, each server is checked as today.
- **`tools.list`** keeps returning full `McpTool` objects for one server, or every server, from the same index.
- **Docs.** The doc topic leads with `tools.search(query)` as the first step, and the namespace summary in the description names it first.

## Phases

| Phase | Outcome                                                                                    | Touches                                              |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1     | Tool search: index, ranking, `McpToolMatch`, `limit`                                       | `tools`, `workbench-server`                          |
| 2     | Consent for both scopes, project file, precedence, overrides, `${secret:…}`, UI operations | `contracts`, `workbench-server`, `conversation-core` |
| 3     | Settings pages (user and project), Review, Trust page entries, attention targets           | `workbench-app`                                      |

Phase 1 does not depend on the others and can ship first. Phases 2 and 3 ship together: once consent exists, user entries written by hand wait for review, and only the Settings pages offer it.

## Decisions

- **User entries need consent too, except those saved in Settings.** This costs one click for entries written by hand, and in exchange no entry the agent wrote can start a program unreviewed. The alternative was to check a stdio start as a `bash` command. That gives no answer for HTTP entries or for variables sent to a URL, and it asks at call time instead of once.
- **Per-entry consent.** It matches how users think about servers and avoids re-approving every server when one is added.
- **The project file lives in `.nerve/config/mcp.json`**, alongside Nerve's other project configuration, rather than in `.mcp.json` at the root (Claude Code's file). See open questions.
- **Search improves `tools.search` instead of adding a method.** This follows the rule of one name per idea.
- **No database schema change.** Trust uses the existing table, secrets the existing vault, and the index the cache folder.

## Open questions

1. **Read `.mcp.json` (Claude Code) and `.vscode/mcp.json` as well?** This would help interoperability, at the cost of more files to watch and a different key in VS Code (`servers`). A one-time **Import** on the project page is a cheaper first step.
2. **Turning one of the user's servers off for one project, for that user only.** Project settings are shared through the repository, so there is no place for a personal per-project override today. Is "disable it in the project file" enough?
3. **Tool-level enablement.** Should Settings let the user hide individual tools of a server from the agent? Permission rules on `mcp:tool/<server>/<tool>` already deny them. Hiding would also shrink search results.

## Later

- **OAuth sign-in** through pi-mcp's `startMcpSignIn` and `completeMcpSignIn`, with a **Sign in** button on the server row. Tokens would live in the credential vault, behind a `McpOAuthServerStore` built on the vault.
- **Server notifications to the conversation** (logging, resource updates), which the namespace drops today.

## Testing

- **Unit:**
  - digests and re-approval per entry;
  - precedence and overrides;
  - secret scoping (a project entry cannot reach user secrets);
  - pending servers are never spawned (a fake transport asserts no start);
  - index invalidation on an entry change and on `list_changed`;
  - ranking order, `limit` and its note, and `arguments` rendering for nested and optional fields.
- **Agent surface:** `method-risk`, `sdk-conventions` and `description` tests for the new types and the `limit` rule. Doc-topic rendering.
- **QA on a dev slot** (`nerve-qa`):
  - add a server through Settings and test it;
  - a project file with a new server shows on Trust and in the attention list, and stays off until it is approved;
  - changing the entry in the repository asks again;
  - the agent finds a tool with one `tools.search` call and calls it in the next script.
