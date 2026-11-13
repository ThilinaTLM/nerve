# Operation-level rules

Part of [Extensions](README.md).

## Problem

Each SDK call is authorized as its equivalent direct tool ([architecture](../../architecture/code-mode.md#permissions)): `jira.issues.create` as `jira_create_issue`, `diagram.render` as `kroki_export`. The broker admits only tool names on its `brokerable()` list. Removing the direct tools removes those identities, and MCP and add-on methods have no direct tool to borrow.

## Design

A nested check becomes `{ operation, targets, risk }` instead of `{ toolName, args }`:

- **Operation** is declared per method in its namespace (default `<namespace>.<path>`). The broker accepts any operation of a namespace contributed by a registered extension, which replaces `brokerable()`.
- **A rule for `quick_script` may match** an operation pattern (`jira.issues.create`, `confluence.pages.*`, `mcp.github.*`), its **targets** (project key, space key, page ID, URL host, MCP server) and **risk**. Each method declares how it extracts targets.
- **Risk-based built-in rule sets keep working unchanged**, because every method still declares its risk.
- Script classification, the user-approval ceiling and "deny always wins" stay as they are.
- **Raw requests become operations** with method and path targets (`jira.request` `DELETE /rest/api/3/issue/*`). Rules can then allow specific raw writes, and the raw-request special case in the broker disappears.
- **`web.fetch` and `web.search` keep authorizing as `web_fetch` / `web_search`**, because those direct tools stay. One rule then governs a URL host whichever route the agent takes. Workspace file reads and writes keep authorizing as `read`, `write` and `edit` for the same reason.

## Contract and migration

- The rule contract change lives in `packages/contracts`. Rule sets and overlays are configuration, not database tables, so there is no database change.
- Built-in rule sets are migrated in the same change.
- User rules that name `jira_*`, `confluence_*`, `kroki_export` or `generate_image` are rewritten to operation rules in the release's single home migration step. Project overlays get the same conversion through their configuration version chain. A converted overlay changes bytes, so existing project trust is kept only under the rule in [configuration](../../architecture/configuration.md#project-configuration-versions): a deterministic conversion of approved input.
