# Trust and consent

Some resources run code or change what agents may do when Nerve loads them: permission rule sets and overlays, agent settings (`agent.json`) and project capability and extension settings, agent and sub-agent profiles, skills, prompt suggestions, installed extensions and MCP server entries. Nerve uses such a resource only after the user has approved its exact content, at user and project level alike: nothing that changes what agents do is used before the user has seen it. Built-in resources ship with the release and are trusted. This page owns how those decisions are stored and when an approval stops applying. Rule sets and approvals of individual tool calls are [permissions](permissions.md), not trust.

## Rules

1. **Every trust decision is a row in `trusted_resource`** in core SQLite (`data/nerve.sqlite`). There are no trust files. _Why:_ one store gives one view of every decision, atomic decisions, cascade on project removal, and keeps decisions out of the documents the agent's file tools edit.
2. **A decision is bound to content.** It names the exact content approved (`content_digest`); different content is not trusted, whatever its path.
3. **Only the user decides.** Decisions are made through user-UI operations; no agent tool, `quick_script` namespace or extension API can reach them. A guard test enforces this (below).
4. **Unknown means untrusted.** A missing row, a `rejected` row, a digest mismatch or an unreadable record all leave the resource unused, with a diagnostic that names the review. Only the UI and the attention bell tell `needs_review` and `declined` apart.
5. **Nothing runs before trust.** Trust is checked before any code of the resource runs or any of its settings applies.
6. **Who changed it decides, not where it lives.** A change made through Nerve's own UI is the user's decision and keeps trust; any other change (the agent, a script, `git pull`, an editor) needs review. This holds for user files too, because the agent's file tools and shell reach the Nerve home.

_Limit:_ decisions live in `data/nerve.sqlite`, which an agent with an unrestricted shell can write. Trust stops accidents, the `configure-nerve` flow and casual prompt injection, not a deliberately hostile agent with shell access; only an OS sandbox closes that.

## The three states

Every surface and every agent diagnostic uses the same three names, derived by one resolver, `TrustedResourceService.trustState(row, digest)` (and `state(kind, projectId, resourceKey, digest)`). Server code never reads `status` and `contentDigest` itself.

| State          | Meaning                                                            | Resource used | Asks for attention |
| -------------- | ------------------------------------------------------------------ | ------------- | ------------------ |
| `needs_review` | No decision for this content: new, or changed since it was trusted | No            | Yes                |
| `trusted`      | The user trusted exactly this content                              | Yes           | No                 |
| `declined`     | The user declined it                                               | No            | No                 |

| Stored row                | State          |
| ------------------------- | -------------- |
| None, or unreadable       | `needs_review` |
| `trusted`, digest matches | `trusted`      |
| `trusted`, digest differs | `needs_review` |
| `rejected` (any digest)   | `declined`     |

**A decline does not depend on the content.** An approval is tied to the digest because trusting new content would be unsafe; a decline is the safe direction, so asking again after every `git pull` only adds noise. A surface may show "Changed since you declined" (`changedSinceDecision` on skills) without raising attention. Configuration resources report a declined item as state `declined`, with a message that says the user declined it and that the agent should mention it only if it matters for the task; it never appears in the attention list.

**Where the user decides.** Every `ConfigurationResource` kind is reviewed through one pair of operations: `configuration.review` returns what the item can do in plain language (each line with a short label, a `broad` flag and a `new` flag against the stored snapshot) and the files it comes from, and `configuration.decide` records the decision on the reviewed digest, refusing a stale one ([`configuration-review.ts`](../../packages/workbench-server/src/core-host/configuration/review/configuration-review.ts), one summarizer per kind beside it). It routes extension consent and MCP entries to their owners and everything else to `TrustedResourceService`, storing the reviewed lines as `grants` (`{ items }`) so the next review can mark what is new. The app shows every review in one dialog with the same actions: Needs review offers Decline and Trust, Trusted offers Revoke (which declines), Declined offers Trust; Not now leaves it waiting. Undecided items are announced by the titlebar bell island, the transcript marker, the count badge on the item's Settings nav entry, and one line in the project's conversation welcome ([conversation state and attention](conversation-state-and-attention.md)).

### Edits made in Nerve keep trust

When the user changes a trusted file through Nerve's own UI, at either scope (the permission rule editor and "Always allow", `agent.json`, profiles and sub-agents, project `extensions.json`, prompt suggestions and the suggestion choices file), it stays `trusted`. One helper, [`trusted-write.ts`](../../packages/workbench-server/src/infrastructure/configuration/trusted-write.ts) (`captureTrust`), reads the file, writes the new bytes and moves the row's `content_digest` to the digest of the bytes it wrote (never a re-read); `ProjectMigrationService.transact` and the user-scope writers both use it. It does so only if the row was `trusted` **and** the bytes read before editing match that digest, and only if the file still holds exactly the written bytes. A file that `needs_review` or is `declined` keeps that state, as does a file changed outside Nerve in the meantime. A file created through Nerve is trusted, unless a decision about its path already exists.

Any other change (a hand edit, `git pull`, a write by the agent, an agent tool, `quick_script` or an extension) leaves the old digest, so the file `needs_review`.

### Pending permission files keep the last trusted version

Ignoring a pending user rule set, user `permissions.json` or user `agent.json` would also drop the user's guardrails. So while one waits, the last version this process trusted stays in effect, like a file that is invalid on disk ([`scoped-permission-source.ts`](../../packages/workbench-server/src/core-host/permissions/scoped-permission-source.ts), [`agent-layers.ts`](../../packages/workbench-server/src/infrastructure/configuration/agent-configuration/agent-layers.ts)). After a restart with no trusted version, tool calls under a pending permission file are configuration-blocked (diagnostic `needs-review`, the call card offers Review); a pending user `agent.json` layer is skipped. A profile that requires a pending rule set is unavailable. Pending project overlays are excluded as before, so the user policy applies.

**MCP entries are the exception.** The form shows and writes the whole entry, so saving it counts as a full review and approves it from any state (`mcp.servers.save`).

### Guard test

[`trust-surfaces.test.ts`](../../packages/workbench-server/src/core-host/trust-surfaces.test.ts) lists the operations that record, withdraw or advance a decision (`configuration.decide`, the two project enablement-file decisions `extensions.trustProject` and `promptSuggestion.projectFile.trust`, and the UI saves above) and asserts that none is an agent tool, a `quick_script` method or an extension UI bridge method. It also fails for any protocol operation whose name mentions trust, consent or approval and is not classified in that list, so a new trust-moving operation must be classified before it merges.

## The table

| Column           | Meaning                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | What sort of resource (below). Validated in code against [`trustedResourceKindSchema`](../../packages/contracts/src/domains/core/trusted-resource.ts), not by SQL, so a new kind needs no table rebuild. |
| `project_id`     | The project for a project resource; `NULL` for a user resource. Removing a project removes its decisions.                                                                                                |
| `resource_key`   | What is trusted: a file path, or an extension folder. One decision per `(kind, project_id, resource_key)`.                                                                                               |
| `name`           | Display label (suggestion name, extension id).                                                                                                                                                           |
| `content_digest` | `sha256:<hex>` of the approved content (what it covers is per kind). The algorithm prefix lets it change later.                                                                                          |
| `status`         | `trusted` or `rejected` (shown as `declined`). Revoking keeps the row as `rejected`, so the decline stays.                                                                                               |
| `grants`         | Optional JSON: what the user approved beyond the digest, validated by the kind's schema in contracts. `NULL` for kinds without one.                                                                      |

## Kinds

| Kind                  | Resource                                                                                                                                                                 | Digest covers                                                                                   | `grants`                       | Decided in                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions`         | A permission overlay: user `config/permissions.json` or project `.nerve/config/permissions.json`                                                                         | Exact file bytes                                                                                | Review snapshot                | Settings → Permissions                                                                                                                                            |
| `capabilities`        | `agent.json` (user or project); project capabilities, `extensions.json`, `prompt-suggestions.json`                                                                       | Exact file bytes                                                                                | Review snapshot (`agent.json`) | `agent.json`: the notice on General (and Tools, Skills, MCP servers); `extensions.json`: Settings → Extensions; `prompt-suggestions.json`: Settings → Suggestions |
| `agent_profile`       | A profile file: user `agent/agent-profiles/*` or project `.nerve/agent-profiles/*`                                                                                       | Exact file bytes                                                                                | Review snapshot                | The profile's page under Settings → Agents or Sub-agents                                                                                                          |
| `prompt_suggestion`   | A suggestion file (user or project)                                                                                                                                      | Exact file bytes                                                                                | Review snapshot                | Settings → Suggestions                                                                                                                                            |
| `skill`               | A skill folder: user (`agent/skills/<name>`, home `.agents/skills/<name>`) or project (`.nerve/skills/<name>`, `.agents/skills/<name>` in the project and its ancestors) | Every file of the folder the skill loader does not ignore, by relative path, in code-unit order | Review snapshot                | Settings → Skills (the skill's page)                                                                                                                              |
| `permission_rule_set` | A user rule set, `config/rule-sets/<id>.json`                                                                                                                            | Exact file bytes                                                                                | Review snapshot                | Settings → Permissions                                                                                                                                            |
| `extension`           | An installed extension folder (user or project)                                                                                                                          | Every file in `dist/`, by relative path, sorted                                                 | Grant snapshot (below)         | Settings → Extensions                                                                                                                                             |
| `mcp_server`          | One entry of an `mcp.json`: user (`project_id` `NULL`) or project; `resource_key` is the server name                                                                     | The entry as written (canonical JSON, variables and secrets not expanded) and its scope         | Review snapshot (below)        | Settings → MCP servers (the server's page)                                                                                                                        |

Extension consent names the content hash the user reviewed: `configuration.decide` grants it through the catalog and refuses a changed folder. A rejected extension is `declined`: it is listed, never opened or allowed again until the user reviews and trusts it, whatever its content.

**Skills.** A skill is instructions, but its folder can hold scripts the skill tells the agent to run, and the folder can be written by a repository, another tool or the agent. So a user or project skill is advertised to the agent and can be applied only while the exact content of its folder is approved ([`project-skill-trust.ts`](../../packages/workbench-server/src/core-host/resources/project-skill-trust.ts), enforced in the [resource loader](../../packages/workbench-server/src/core-host/resources/resource-loader.ts) on every turn). The review lists every file with scripts marked. Built-in skills need no approval. Other tools share the home `.agents/skills` folder; Nerve cannot tell their changes from the agent's, so every review says "changed outside Nerve's settings".

**MCP servers.** An entry starts a program or sends data to a URL, so each entry is approved on its own, in both scopes, and nothing starts, connects or is indexed before ([`mcp-catalog.ts`](../../packages/workbench-server/src/domains/mcp/mcp-catalog.ts), enforced by [`McpServerHub`](../../packages/workbench-server/src/domains/mcp/mcp-server-hub.ts) on every call). The `grants` snapshot is what the review shows: transport, command and arguments or URL, working directory, every environment entry and header as written (a `${…}` reference stays a reference; names that change what runs, like `PATH` or `NODE_OPTIONS`, are flagged), that a stdio server inherits Nerve's environment, and the `${VAR}` and `${secret:name}` references with where each value goes. Values of variables and secrets never appear in it. `configuration.decide` on an entry recomputes the review on the server: the digest must be the entry's current one, and the stored grants are the server's. Saving an entry in Settings records the approval of exactly what was written, from any state (`mcp.servers.save`); entries written any other way (by hand, by the agent, by `git pull`) wait for the user, who decides in the review dialog (`configuration.decide` on the digest `configuration.review` returns). A declined entry stays off. An approved project entry replaces a user entry of the same name; while it waits, the user entry keeps working. Secrets of entries and their precedence are in [configuration](configuration.md#mcp-servers).

## When an approval stops applying

| Resource                          | Needs approval again when                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Configuration files (both scopes) | Any content change outside Nerve's UI. A decline stays.                                                                        |
| Skills (both scopes)              | Any change of any file in the skill folder.                                                                                    |
| Extensions (both scopes)          | Any content change outside Nerve. An update's review lists only new grants, or says the code changed and nothing new is asked. |
| MCP server entries                | Any change to that entry as written (not to a variable's or secret's value). Other entries of the file keep their approval.    |
| Prompt suggestions                | Any change to the suggestion file.                                                                                             |

Project file upgrades keep an approval only when the exact original bytes were approved, because the output is a deterministic conversion of approved input ([configuration](configuration.md#project-configuration-versions)).

### Extension grants

The `extension` grant snapshot lists what the user approved: network origins, model and frame services, account kinds, namespaces and operations, direct tools, and UI contributions (previews with their file types and edit mode, pages, panels, themes). On an update the host compares the new manifest with the snapshot: removed grants narrow the stored snapshot silently, added grants make the extension pending again, and the review lists only what is new. The schema lives with the extension contracts; consent wording is generated from it ([extension platform](extension-platform.md)).

**Credential grants.** The snapshot's `credentials` list holds, per account kind: the provider (a built-in one, or "own code"), the sign-in origins, the OAuth scopes and whether the provider may share identity details. The origins a credential is _sent to_ are the kind's `origins`, already in the network grants. An extension's own credential provider is worded as broad access: it runs its own code with the user's credentials, also in the background to keep them signed in, and the credentials are sent only to the listed origins.

- **Code hash grant.** The SHA-256 of a credential provider's built `credentials.js` is a grant (`<kind>|code|<hash>`), so the review of a change to it says that the credential code changed, and stored credentials are bound to it (below).
- **Binding to stored credentials.** A credential records the hash of the code that wrote it (`codeHash`). Credential code that consent no longer covers is not handed the stored credential: the account is `needs_sign_in` until the user signs in again with the code now approved.
- **Per-platform consent.** An extension that `uses` a platform (accounts other extensions define) is consented per extension and platform: "Uses your github accounts with scopes repo, gist". Each platform and each requested scope is a grant (`uses:<platform>`, `uses:<platform>:<scope>`); an update lists only the scopes that are new. The scopes of every enabled user of a platform are added to the sign-in scopes of the platform's accounts, so a new scope makes the affected accounts `needs_sign_in` ([accounts](extension-platform.md#platforms-and-uses)).
- **Sign-in is user-only.** Starting, answering and cancelling a sign-in, and saving, moving, duplicating and clearing accounts, are `workbench_server` operations of the signed-in app; no agent tool, `quick_script` namespace or extension API reaches them (rule 3).

## Change risk

| Change                                          | Risk                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| New trust kind                                  | Add it to the contracts enum, define what its digest covers and its re-approval rule, and confirm no agent surface can decide it. No table rebuild. |
| What a digest covers                            | Existing approvals stop matching; needs a migration step that recomputes or drops them.                                                             |
| A `grants` schema                               | Older snapshots must still parse; widening is safe, narrowing needs a migration.                                                                    |
| A path that reaches trust from an agent surface | Self-approval. Never.                                                                                                                               |

## Where it lives

| Concern               | Owner                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table and repository  | [`schema.ts`](../../packages/conversation-core/src/storage/schema.ts), [`trusted-resource.repository.ts`](../../packages/conversation-core/src/storage/trusted-resource.repository.ts)                                     |
| Decisions and lookups | [`TrustedResourceService`](../../packages/conversation-core/src/conversations/trusted-resource.service.ts) (`trustState` is the only mapping from row to state)                                                            |
| Project file kinds    | [`project-migration/descriptors.ts`](../../packages/workbench-server/src/infrastructure/configuration/project-migration/descriptors.ts)                                                                                    |
| Prompt suggestions    | [`prompt-suggestion-trust.repository.ts`](../../packages/workbench-server/src/domains/prompt-suggestions/prompt-suggestion-trust.repository.ts)                                                                            |
| MCP servers           | [`mcp-catalog.ts`](../../packages/workbench-server/src/domains/mcp/mcp-catalog.ts) (lookup and precedence), [`mcp-service.ts`](../../packages/workbench-server/src/domains/mcp/mcp-service.ts) (saving approves)           |
| Review and decision   | [`configuration/review/`](../../packages/workbench-server/src/core-host/configuration/review/) (`configuration.review`, `configuration.decide`, one summarizer per kind)                                                   |
| Edits made in Nerve   | [`trusted-write.ts`](../../packages/workbench-server/src/infrastructure/configuration/trusted-write.ts) (both scopes)                                                                                                      |
| Upgrade               | Home step [`0007-user-configuration-trust`](../../packages/workbench-server/src/infrastructure/migrations/steps/0007-user-configuration-trust/) (kind renames; existing user files trusted; whole-file suggestion digests) |
| Extensions            | [`extension-consent.ts`](../../packages/workbench-server/src/core-host/extensions/extension-catalog/extension-consent.ts) (the gate over the service; the catalog in the same folder consults it)                          |
