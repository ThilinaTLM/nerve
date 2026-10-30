# Unsupported and damaged homes

Part of [Migration and configuration resilience](./README.md).

## Policy

The supported storage baseline is **0.34.1**. A home older than that is not migrated automatically. The user has two options:

| Option                          | Result                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upgrade through 0.34.1**      | Run Nerve 0.34.1 once to bring the home to the baseline, then run the latest version. All conversation history is preserved.                                                                                                |
| **Start fresh, keep providers** | The old home is archived by renaming it, not deleted. A new home is created. Provider settings and credentials are carried over when they are recognisable. Conversations, artifacts, and runtime data stay in the archive. |

"Start fresh" is a single confirmed action. The archive stays on disk until the user deletes it, and settings show where it is.

### Carrying providers over

In the current layout, providers live in `config/providers.json` and credentials in `secrets/credentials.enc`, encrypted with `secrets/master.key`. Credentials and key are always copied together. A file is carried only if it already validates against the current schema. Nothing is converted, because converting pre-baseline formats would be the compatibility layer this policy avoids. If nothing is recognisable, the user signs in to providers again.

## Required changes

- **Typed admission failures.** [Ledger admission](../../../packages/workbench-server/src/infrastructure/migrations/framework/ledger.ts) reports `Run Nerve 0.34.1 first` for several unrelated causes. Admission should instead return a failure kind, for example `too_old`, `manifest_invalid`, `ledger_unexpected`, or `layout_unrecognized`, so the UI can tell "old" apart from "damaged".
- **Desktop startup screen.** The [startup error page](../../../packages/desktop-shell/src/window/loading-pages.ts) treats unstructured errors as retryable, so an unsupported home gets only a "Try again" button that can never succeed.
  - Offer retry only for transient failures.
  - Unsupported homes offer the two options above.
  - Damaged homes offer "start fresh, keep providers", plus a way to open the data folder or copy diagnostics.
- **Manifest message fix.** [`state-layout.ts`](../../../packages/workbench-server/src/infrastructure/storage-bootstrap/state-layout.ts) has `NERVE_HOME_VERSION = 1`, but the schema accepts manifest versions 1 and 2, and new homes are written as version 2. The rejection message is misleading.
- Update the [storage troubleshooting guide](../../../packages/website/src/content/docs/troubleshooting/storage-and-migration.md) to describe both options.
