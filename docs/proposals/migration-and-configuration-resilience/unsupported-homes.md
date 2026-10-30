# Unsupported and damaged homes

Part of [Migration and configuration resilience](./README.md). Updated by [follow-up plan, section 1](./follow-up-plan.md#1-replace-start-fresh-with-instructions).

## Policy

The supported storage baseline is **0.34.1**. A home older than that is not migrated automatically. Startup shows the home folder path and instructions, not a reset action.

### Too old

To keep your conversation history, run Nerve 0.34.1 once against the same home, then reopen this version.

Otherwise: **Close Nerve, delete or move this folder, then reopen Nerve to start with an empty home.** Moving the folder lets the user retain the original data. Deleting it permanently removes its contents, so back it up first if needed. An empty home requires provider setup and sign-in again.

### Damaged or unrecognized

Startup shows the same delete-or-move instruction, plus **Open folder** and **Copy diagnostics**. Running 0.34.1 is not presented as a repair for damaged metadata.

Nerve does not rename or delete the home, copy provider settings or credentials, or record/display an archived-home location. Existing user-created backups remain the user's responsibility.

## Admission and desktop behavior

- **Typed admission failures** distinguish `too_old`, `manifest_invalid`, `ledger_unexpected`, and `layout_unrecognized`. See [ledger admission](../../../packages/workbench-server/src/infrastructure/migrations/framework/ledger.ts).
- The [desktop startup page](../../../packages/desktop-shell/src/window/loading-pages.ts) renders the home path and the appropriate instructions for each kind. Admission failures never offer retry; retry remains limited to transient failures.
- The home manifest accepts versions **1 and 2** on read; new homes use **version 2**. Rejection messages identify the supported versions rather than implying that only v1 is valid. See [state layout](../../../packages/workbench-server/src/infrastructure/storage-bootstrap/state-layout.ts).
- The [storage troubleshooting guide](../../../packages/website/src/content/docs/troubleshooting/storage-and-migration.md) describes the manual options and their consequences.
