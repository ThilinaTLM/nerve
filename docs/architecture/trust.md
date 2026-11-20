# Trust and consent

Some resources run code or widen authority when Nerve loads them: project permission overlays, project capability and extension settings, project agent profiles, prompt-suggestion predicates and installed extensions. Nerve uses such a resource only after the user has approved its exact content. This page owns how those decisions are stored and when an approval stops applying. Rule sets and approvals of individual tool calls are [permissions](permissions.md), not trust.

## Rules

1. **Every trust decision is a row in `trusted_resource`** in core SQLite (`data/nerve.sqlite`). There are no trust files. _Why:_ one store gives one Trust view, atomic decisions, cascade on project removal, and keeps decisions out of the documents the agent's file tools edit.
2. **A decision is bound to content.** It names the exact content approved (`content_digest`); different content is not trusted, whatever its path.
3. **Only the user decides.** Decisions are made through user-UI operations; no agent tool, `quick_script` namespace or extension API can reach them, and a test asserts it for each kind.
4. **Unknown means untrusted.** A missing row, a `rejected` row, a digest mismatch or an unreadable record all leave the resource unused, with a diagnostic that names the review.
5. **Nothing runs before trust.** Trust is checked before any code of the resource runs or any of its settings applies.

## The table

| Column           | Meaning                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`           | What sort of resource (below). Validated in code against [`trustedResourceKindSchema`](../../packages/contracts/src/domains/core/trusted-resource.ts), not by SQL, so a new kind needs no table rebuild. |
| `project_id`     | The project for a project resource; `NULL` for a user resource. Removing a project removes its decisions.                                                                                                |
| `resource_key`   | What is trusted: a file path, or an extension folder. One decision per `(kind, project_id, resource_key)`.                                                                                               |
| `name`           | Display label (suggestion name, extension id).                                                                                                                                                           |
| `content_digest` | `sha256:<hex>` of the approved content (what it covers is per kind). The algorithm prefix lets it change later.                                                                                          |
| `status`         | `trusted` or `rejected`. Revoking keeps the row as `rejected`, so the Trust view can show it.                                                                                                            |
| `grants`         | Optional JSON: what the user approved beyond the digest, validated by the kind's schema in contracts. `NULL` for kinds without one.                                                                      |

## Kinds

| Kind                   | Resource                                                    | Digest covers                                   | `grants`               | Decided in                      |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------- | ---------------------- | ------------------------------- |
| `project_permissions`  | `.nerve/config/permissions.json`                            | Exact file bytes                                | —                      | Settings → This project → Trust |
| `project_capabilities` | `.nerve/config/agent.json`, capabilities, `extensions.json` | Exact file bytes                                | —                      | Settings → This project → Trust |
| `agent_profile`        | `.nerve/agent-profiles/*`                                   | Exact file bytes                                | —                      | Settings → This project → Trust |
| `prompt_suggestion`    | A suggestion's `enable-js` predicate (user or project)      | The predicate source                            | —                      | Settings → Suggestions          |
| `extension`            | An installed extension folder (user or project)             | Every file in `dist/`, by relative path, sorted | Grant snapshot (below) | Settings → Extensions           |

Extension consent is the one decision the generic `trust.decide` operation cannot grant: it only withdraws it (`rejected`), because consent must name the content hash the user reviewed (`extensions.grantConsent`). A rejected extension is treated as pending review, never silently allowed again, and its row stays so Settings → This project → Trust can list it. Removing a row (`trust.delete`) only returns a resource to unknown.

Skills are not trusted resources: they are instructions, not code or authority, and the [resources reference](../../packages/website/src/content/docs/reference/resources.md) tells users to review repository-controlled ones.

## When an approval stops applying

| Resource                             | Needs approval again when                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Project files and project extensions | Any content change. A repository is an untrusted source.                                     |
| Prompt-suggestion predicates         | The predicate changes.                                                                       |
| User extensions                      | The update adds a grant. A code-only change keeps the approval and updates `content_digest`. |

Project file upgrades keep an approval only when the exact original bytes were approved, because the output is a deterministic conversion of approved input ([configuration](configuration.md#project-configuration-versions)).

### Extension grants

The `extension` grant snapshot lists what the user approved: network origins, capabilities, account kinds, namespaces and operations, direct tools, and UI contributions (previews with their file types and edit mode, pages, panels, themes). On an update the host compares the new manifest with the snapshot: removed grants narrow the stored snapshot silently, added grants make the extension pending again, and the review lists only what is new. The schema lives with the extension contracts; consent wording is generated from it ([extension platform](extension-platform.md)).

## Change risk

| Change                                          | Risk                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| New trust kind                                  | Add it to the contracts enum, define what its digest covers and its re-approval rule, and add it to the agent-unreachable test. No table rebuild. |
| What a digest covers                            | Existing approvals stop matching; needs a migration step that recomputes or drops them.                                                           |
| A `grants` schema                               | Older snapshots must still parse; widening is safe, narrowing needs a migration.                                                                  |
| A path that reaches trust from an agent surface | Self-approval. Never.                                                                                                                             |

## Where it lives

| Concern               | Owner                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table and repository  | [`schema.ts`](../../packages/conversation-core/src/storage/schema.ts), [`trusted-resource.repository.ts`](../../packages/conversation-core/src/storage/trusted-resource.repository.ts)            |
| Decisions and lookups | [`TrustedResourceService`](../../packages/conversation-core/src/conversations/trusted-resource.service.ts)                                                                                        |
| Project file kinds    | [`project-migration/descriptors.ts`](../../packages/workbench-server/src/infrastructure/configuration/project-migration/descriptors.ts)                                                           |
| Prompt suggestions    | [`prompt-suggestion-trust.repository.ts`](../../packages/workbench-server/src/domains/prompt-suggestions/prompt-suggestion-trust.repository.ts)                                                   |
| Extensions            | [`extension-consent.ts`](../../packages/workbench-server/src/core-host/extensions/extension-catalog/extension-consent.ts) (the gate over the service; the catalog in the same folder consults it) |
