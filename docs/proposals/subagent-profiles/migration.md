# Migration and cleanup

Part of the [sub-agent profiles proposal](README.md).

All data conversion goes into the unreleased `0001-conversation-core` migration step, which already rewrites `harness.json` and capability files. No second step is added. The migrated home must not contain any of the legacy shapes below; there are no compatibility readers afterwards, except the [one tolerant read](#project-files) for project files that Nerve does not own.

## Settings

| Legacy                                                                                     | Becomes                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `harness.exploreAgent` (model, thinking level)                                             | If it differs from the built-in, a user profile file `agent/subagents/explore.md` with that model and thinking level; otherwise nothing |
| `harness.asyncSubagent` (model, thinking level, compaction)                                | Likewise, `agent/subagents/developer.md`                                                                                                |
| `explore` in `harness.tools.disabled`                                                      | `explore: false` in `config/subagents.json`                                                                                             |
| `subagent_new`, `subagent_list` in disabled lists                                          | The `subagents` capability group                                                                                                        |
| `toolSettings.explore`, `toolSettings.subagents` in user and conversation capability files | Removed                                                                                                                                 |
| `explore` in capability tool selections                                                    | Removed                                                                                                                                 |

The `exploreAgent` and `asyncSubagent` schemas, defaults and patch handling are deleted from contracts, server persistence and the settings UI.

## Project files

Nerve does not migrate files inside projects. When it reads a project `.nerve/config/capabilities.json` that still has `toolSettings.explore`, `toolSettings.subagents` or an `explore` tool entry, it strips them instead of failing, and the next save from Nerve drops them. This is the only tolerated legacy shape.

## Files

- **`data/reports/`** is removed.
  - Existing Explore report files are moved into the conversation directory of the child they belong to (`data/conversations/<childId>/reports/`), where the importer knows the mapping.
  - Report files with no known child are deleted.
  - `reportsPath` is removed from storage paths, and the storage usage and cleanup views count reports per conversation.

## Code removed

- **Tools:**
  - the `explore` tool: catalog definition, runtime, permission metadata and policy resource
  - its `delegated_reports` result projection profile
  - `subagent_new` and `subagent_list`
- **Core:** `explore-tool.ts`, the `exploring` exclusion set and the `explore` flag of child initialization.
- **Server:** the Explore branch of `CapabilityService.initializeChild`, which disabled all tools and skills.
- **App:**
  - `ExploreToolView`, `explore-progress`
  - the Explore and Async Subagents tool groups and dialogs (`AsyncSubagentToolDialog`, `async-subagent-options`)
  - the teammate/Explore role split and `executionKind`
- **Legacy transcripts:** old `explore`, `subagent_new` and `subagent_list` calls render with the generic tool card. Their children are labeled `explore` or `developer`, derived from the legacy tool name.

## Database

One change: a nullable `conversation_config.instructions` column. It is added in the same unreleased step and tested on a copied slot.

## Documentation updates at implementation

- **Create** `docs/architecture/conversation-core/delegation.md` from this proposal, then delete `docs/proposals/subagent-profiles/`.
- **`conversation-core/README.md`:**
  - the Configuration decision (instructions; per-conversation `harness.json`)
  - the capability paragraph (no Explore special case)
  - the glossary
- **`conversation-core/events-and-context.md`:**
  - the waiting delegation tool (Explore) lines
  - compaction settings resolution
- **`conversation-core/data-model.md`:** the `instructions` column.
- **`tool-result-projection.md`:**
  - remove `delegated_reports`
  - add the sub-agent notice cap
- **`storage.md`:**
  - the conversation `harness.json` and `reports/`
  - `agent/subagents/`, project `.nerve/subagents/`, `config/subagents.json`
  - remove `data/reports/`
- **`async-bash-and-launches.md`:** the non-goal line that mentions Explore.
- **Website:** `reference/tools.md`, plus a new sub-agent profile format reference next to prompt suggestions.
