# Follow-up plan: simplification and remaining gaps

Part of [Migration and configuration resilience](./README.md). Planned 2026-10-30 on branch `feat/migration-config-resilience`. Not yet implemented.

## Decisions

| Topic                                     | Decision                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Homes older than 0.34.1, or damaged homes | Show instructions only. Remove the one-click "start fresh, keep providers" and the archived-home display.                          |
| Multi-file project merges                 | Drop them. Keep only single-file version bumps. When old project files are found, show a notice instead of importing them.         |
| Unreadable conversations                  | Show one header activity item listing them, each with a confirmed Delete. No conversation-list or contract changes, and no export. |
| Small items                               | Add an event-catalog test and a typed missing-asset response with an image placeholder. Test slots are already removed.            |

## 1. Replace start-fresh with instructions

**Startup screen (desktop).** Admission keeps its typed failure kinds. The screen shows the home folder path and offers:

- **Too old:** "To keep your conversation history, run Nerve 0.34.1 once, then reopen this version." Otherwise: "Close Nerve, delete or move this folder, then reopen Nerve to start with an empty home."
- **Damaged:** the delete-or-move instruction, plus **Open folder** and **Copy diagnostics**.
- Retry stays limited to transient failures.

**Remove:**

- `storage-bootstrap/start-fresh.ts` and its test
- the `archived-home.json` provenance
- `archivedHomeDir` in storage usage and the archive section of the Storage settings page
- the desktop recovery IPC, preload and bridge action

**Update** [unsupported-homes.md](./unsupported-homes.md) and the website troubleshooting guide to match.

## 2. Keep only single-file version bumps for project configuration

**Kept chains.** Each one reads one file and writes the same file:

- launch definitions v1 → v2
- permission overlay v1 → v2
- capabilities v2 → v3
- integrations v1 → v2
- subagents catalog v1 → v2
- agent profile v1 → v2
- prompt suggestion v1/unversioned → v2

**Removed:**

- **Composite inputs:** harness / capabilities / integrations / subagent catalog merged into `config/agent.json`, and harness merged into `conversation-defaults.json`.
- **Migration prerequisites and their ordering:** for example, integrations waiting for agent-settings import.
- **Ordered legacy sources:** `subagents/<name>.md`, catalog entries turned into profile files, and `tasks/definitions.json` turned into launches.
- **Durable reset suppression** for retained legacy sources.
- **Cross-file trust fan-out.** Trust carry-over stays for a same-file version bump only.
- **The 0001 home staging of legacy DB task definitions**, and the launch chain's staging source. This means launch definitions stored only in a 0.34.1 home database are not carried over. Flagged for confirmation during review.
- **Frozen shapes** that only these paths used.

**Legacy-file notice.** Each project type may declare known legacy filenames, such as `harness.json`, `tasks/definitions.json` and `subagents/*.md`. When a feature loads that project and finds legacy files:

- A header activity item says "Project settings from an older Nerve weren't imported; configure them again." It lists the files.
- It offers **Open folder** and a confirmed **Remove old files**, which moves them to the home quarantine. Removing the files resolves the notice permanently, so no dismissal state is stored.
- Nothing is converted.

**Expected effect:** the project migration framework shrinks to "classify one file, run its version chain, quarantine, write, reset". The agent-configuration project chains lose most of their code.

## 3. Unreadable conversations as one activity item

The repository already reports per-conversation read failures (`ConversationRepository` failure reporter). The plan:

- The server collects the failed conversation IDs into an in-memory set. The set is filled during startup recovery, which enumerates every conversation, and by later read failures.
- It publishes one header activity item through the existing server activity service: "N conversations couldn't be loaded". Each entry shows the raw title if readable (otherwise the ID), the project, and the error summary.
- **Delete** asks for confirmation. It removes the conversation and its descendants from raw identity, without validating the broken row first. Today's delete starts with a validating `get()` and would fail. Delete also removes the conversation's files.
- No list entry, no new contract shape for conversations, no export.

## 4. Small items

- **Event catalog test:** every event name the server publishes must exist in the public event catalog. Also raise the "could not publish" log from warning to error.
- **Missing assets:** a missing backing file returns a typed 404 instead of an `ENOENT` 500, with no absolute path. The transcript shows an image placeholder. Wrong ownership stays a separate error.

## Ownership and order

Sections 1, 2 and 3+4 are independent and can run in parallel:

| Work             | Scope                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section 1        | desktop-shell, storage-bootstrap, storage settings, docs                                                                                            |
| Section 2        | project-migration framework, agent-configuration project chains, launch/permission/prompt-suggestion chains, 0001 staging removal (checksum update) |
| Sections 3 and 4 | conversation-core, conversation-channel/activity, asset route, transcript image rendering, contracts event test                                     |

## Validation

- Unit tests for every changed owning layer, plus `pnpm fix:focused && pnpm check:focused`.
- Rehearse both datasets again on fresh slots (`pnpm storage:copy --from data/storage-0-34-1 --slot 5`, and the same for 0.37.0) and confirm no project writes.
- On temp projects:
  - each kept version bump
  - the legacy-file notice and Remove old files
  - corrupted-file handling (regression)
- On a sanitized slot:
  - conversation fault cases 1 and 4 show the activity item, and Delete removes the conversation
  - a missing asset shows the placeholder
- One real GPT 6 Luna run in a healthy temp project.
