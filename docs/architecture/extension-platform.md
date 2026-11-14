# Extension platform

An **extension** is a unit of capability with its own settings, accounts and permissions. It contributes `quick_script` namespaces and optionally direct tools. The four built-ins (Atlassian, Web, Diagrams, Image generation) are written against `@nervekit/extension-api` and run in-process; the host knows none of them by name. This page owns the API contract and the security rules the host enforces on it. The runtime and permission model are in [code mode](code-mode.md) and [permissions](permissions.md), settings and accounts storage in [configuration](configuration.md#extension-settings), and packages in [codebase](codebase.md).

The API is built to be isolated: extension code could later run in its own sandbox. Installable third-party extensions are not shipped (see [Not shipped](#not-shipped)).

## Rules

1. **Extension code imports only `@nervekit/extension-api`** and its own files. No host objects, no `fetch`, no file system. *Why:* this is what keeps the contract publishable and sandbox-ready. The boundary checker enforces the dependency, and the [`extension-naming` rule](../../scripts/checks/extension-naming-policy.ts) forbids every other production source from naming an extension; only the built-in list and frozen migration steps do. Its exception list is reviewed and may only shrink: the `planning` rule set names the Atlassian namespaces because a quick_script operation's tool group is its namespace and extensions declare no "read-only research" flag.
2. **Every `ctx` call is async and exchanges plain data** (JSON values, `Uint8Array`, handles); no class instances or callbacks cross. *Why:* a later `__hostCall` transport must work without an API change.
3. **The extension declares; the host decides.** Permissions, approvals, network policy and limits are host code. The manifest is plain data except its hooks (`test`, `availability`, `parse`, `authorize`, `run`); contracts validate the data part, typed against the API.
4. **`parse` and `authorize` are synchronous and pure**, so authorization happens before any I/O. `authorize` returns one check, several (all must pass) or none.
5. **Account kinds are unique across extensions**; the registry rejects duplicates.

## Context security

`ctx` is the only way out of extension code ([`ExtensionContext`](../../packages/extension-api/src/types.ts), host side in [`extension-host/`](../../packages/tools/src/quick-script/extension-host)).

- **Secrets never reach extension code.** `ctx.accounts.selected` returns non-secret fields only. `ctx.http` injects the credential on the host side, in the shape the account kind declares (`basic`, `bearer` or a named header). Breaking this makes every extension a credential-exfiltration risk, so a new `ctx` service must never return or echo a secret.
- **Credential origins are checked per hop.** A credential is sent only to the account kind's own `origins` (templated from account fields). Each redirect hop is re-resolved: the credential header is removed from every hop and added back only if that hop's origin is allowed. A 401/403 from a redirect target that got no credential (a signed media URL) is a normal response; only the credentialed origin's 401/403 becomes the host error (`UNAUTHORIZED` ends the run, `FORBIDDEN` names the account and the fix). *Why:* the extension must not need to know about, or be able to leak, auth headers.
- **The network is an allowlist.** `ctx.http` reaches only origins in the manifest's `permissions.network`. Patterns are URL origins with `*` for one host label, `*` alone for any public http(s) origin (Web fetch; it never carries a credential), or templates over a selected account's field or an extension setting. Templated destinations are user-supplied and may be on a private network; every other origin goes through the SSRF guard on every hop, and redirects are manual and capped.
- **Uploads stream from the host.** A multipart part with `data: { handle }` is read and streamed by the host from the authorized artifact or workspace file, so large bytes never enter extension code. `ctx.artifacts.read` has a smaller limit than transfers; limits live in code.
- **Files are authorized, not ambient.** A method reaches a workspace file only through a handle its `authorize` declared as a host-tool check (such as `read`); an undeclared read fails with `DENIED`. Extension code has no file-system access, and its docs are declared as paths the host reads.
- **`ctx.authorize` has a risk ceiling.** It runs the same nested authorization as declared checks, is bound to the running call, and is refused with `BAD_REQUEST` before any approval when its risk is above the method's declared `risk`. It is unavailable outside a call. This is the same invariant as the executor's declared-risk guard in [code mode](code-mode.md#permissions), and the script scan depends on it.
- **`riskFromArgs`.** A method whose risk depends on argument values (a raw `request`: GET is network, anything else destructive) declares `riskFromArgs: true`. The script scan then needs literal arguments and takes the risk from the method's own `authorize`; with a computed verb the script counts as destructive and is not admissible by operation rules. The scanner names no extension.
- **Approval target.** The approval of a quick_script or extension tool covers the resolved extension settings and, per enabled extension, each selected account's id, kind, name and non-secret fields. Switching an account's site must end approvals.
- **Errors.** Extensions throw `ExtensionError(code, message, { fix })` from a closed code set; the host formats it for the agent. A failing account `test` hook reports a reason (`rejected`, `restricted`, `unavailable`, `unreachable`) so Settings can word it.

## Availability and accounts

- Availability is **derived** from the manifest: the extension's switch and the namespace's `enabledBy` (one setting or any of a list), then `requires` (the selected account exists and has a saved secret), then the optional `availability(ctx)` hook. Reasons and fixes are generated with the extension's name, so there are no per-extension texts. Details in [code mode](code-mode.md#configuration).
- **Accounts are generic**: stored by kind, user-only, secrets under `account:<kind>:<id>` ([configuration](configuration.md)). Account ids are local to a home, so a project file naming an account this user lacks leaves the extension unavailable with a fix naming the extension page; it never falls back to another account. Default project and space keys stay on the Atlassian account, because a key is meaningful only on its site.
- The Settings account list, dialog and "Test" button are generated from the manifest; no app code names a product.

## Direct tools

A manifest can contribute tools (`defineTool`) for work the agent does often enough that discovery through `sdk.*` is too costly; `web_search` is the case. A tool is usually bound to a namespace method, so it shares `parse`, `authorize`, the operation and one implementation (`parse` receives the tool's arguments object as its single argument; a script passes positional arguments). A tool without `method` declares its own `parse`, `authorize` and `run`, and an optional `present` that splits the result into agent text and transcript value.

- A tool is offered only while its extension and switch are on and its `requires` are met; unavailable tools are left out of the request.
- Permission rules match the operation (`web.search`) through `quick_script` operation rules. Exceptions naming the tool itself still validate against core tool names only (see [Not shipped](#not-shipped)).
- `web_fetch` stays a core tool; the Web extension's `web.fetch` is authorized as `web_fetch`, so URL rules and approvals are unchanged whichever route is used.

### Display kinds and projection

A tool's result renders with one of a small platform set, `DisplayKind` (`text`, `markdown`, `links`, `table`, `artifact`), so the app needs no per-tool view: one transcript view renders `details.display` by kind, and the Tools page groups extension tools under their extension from the tool list. Adding a kind means a renderer, a projection rule and a contract change, so it needs a reason an existing kind cannot meet.

The agent projection follows the kind: a `links` result is projected like the core search tool (item-aware, `details.results` holds the displayed items), every other kind uses the prose projection ([tool-result projection](tool-result-projection.md)). The transcript value and the agent text may differ (`present`); keep the agent text complete and the transcript compact.

## Other decisions

- **Extension-owned conversions stay in the extension.** Confluence storage-format conversion is Atlassian code. Plain HTML to Markdown is a host utility (`ctx.text.htmlToMarkdown`, run in the tools worker with time and size limits), because one shared implementation is simpler than a second one and is sandbox-friendly.
- **Docs are declared, not read.** A topic's `file` is relative to the extension's folder and read by the host through `readExtensionDoc`, from source or `dist/extension-docs/`.
- **The registry has no default.** The host builds it once from the built-in list and passes it to every consumer; the executor throws without one. `@nervekit/extensions` exports the definitions list only, and conversion to the registry form is host code in `tools`.
- **Tests that compose the runtime with built-ins live in the server** (`packages/workbench-server/test/extensions/`), because neither package may import the other. `extension-api/testing` provides a fake `ctx` for unit tests next to extension code.
- **Image backends stay in the host**; the extension asks through the declared `models.image` capability. A call option that does not depend on settings is validated in `parse`, so a bad call never reaches an approval.
- **Settings UI is generated** from the manifest schema (field types, `visibleWhen`, `advanced`, inherited value shown read-only where a field is not settable in the scope). The field set stays small: add a type only when a built-in needs it, because each needs a control, validator and provenance display. Arbitrary JSON Schema is not accepted.

## Change risk

| Change | Risk |
| ------ | ---- |
| New `ctx` service or `http` option | Security boundary: must keep secrets host-side and stay serializable. Update the fake context. |
| Credential injection, origin matching, redirects | Credential leak. Test each hop. |
| Declared risk, `ctx.authorize`, `riskFromArgs` | Silent permission widening. The script scan and declared-risk guard depend on them. |
| Account kind or secret id format | Needs a home migration step (files and secret store). |
| New display kind | Contracts, transcript renderer and projection rule. |
| Naming an extension outside its folder | Fails the `extension-naming` rule; derive from the registry instead. |

## Not shipped

The remaining design is in [proposals/extension-platform](../proposals/extension-platform/README.md): running a built-in in the QuickJS sandbox over `__hostCall`, and installable extensions (packaging, consent, allowlist, limits on third-party agent-facing text). MCP servers are a separate proposal ([mcp](../proposals/mcp.md)).
