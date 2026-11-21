# Background jobs

The daemon has one way to run work that no request or conversation started. A **background job** is a named piece of daemon work that runs periodically, and Settings shows every job with its state. The only job today is [account credential refresh](#account-credential-refresh). Later jobs (scheduled workflows, extension background work, git fetch for open projects, maintenance) use the same mechanism.

Code: [`BackgroundJobService`](../../packages/workbench-server/src/domains/background-jobs/background-jobs.service.ts) and [`BackgroundJobNotices`](../../packages/workbench-server/src/domains/background-jobs/background-job-notices.ts); contracts in [`background-jobs`](../../packages/contracts/src/domains/background-jobs/). UI: [settings](../ui/settings.md#background-jobs).

## Rules

- **One mechanism** for every kind of background work in the daemon, correct across sleep, wake, clock changes, restarts and shutdown.
- **Bounded:** a time limit per run, no overlapping runs, backoff on failure.
- **No persisted scheduler state.** A job reads its own domain's state; nothing is registered, updated or removed when that state changes, and a restart needs no recovery.
- **Daemon only.** Background work runs only while a daemon runs (always for a hosted daemon; on the desktop while the window is open or Nerve is in the tray). Nothing starts a daemon at login.
- **User-only surface.** `backgroundJobs.list` and `backgroundJobs.runNow` are `workbench_server` operations, like other user-UI operations: no agent tool, `quick_script` namespace or extension reaches them.

## Job

A job is a **sweep**, not a queue of work items: each run looks at its domain's state and does whatever is due. Work that must happen at an exact moment can be a sweep that runs what is due since the last run.

| Field                  | Meaning                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                   | Stable (`accounts.credential-refresh`).                                                                           |
| `label`, `description` | Shown in Settings.                                                                                                |
| `intervalMs`           | Time between runs (5 minutes for credential refresh).                                                             |
| `timeoutMs`            | Per run; the run's abort signal fires when it passes (2 minutes for credential refresh).                          |
| `run(signal)`          | One sweep. Returns a short summary for Settings (`Refreshed 2 of 2.`) or throws. It must put no secret in either. |

## Timing

- **Wall clock.** A single ticker checks every 30 seconds and starts the jobs whose next-run time has passed. Long `setTimeout`s are not used, because they drift across sleep and ignore clock changes.
- **After sleep or start.** A job that came due while the machine slept runs once on the next tick, not once per missed interval. Jobs are due on the first tick after the daemon's storage and migrations are ready.
- **Failures.** A run that throws or times out is retried with exponential backoff (capped at the interval); the next success resets it.

## Limits and lifecycle

- One run per job at a time; a job still running when it comes due again is not started twice.
- Jobs run one after another, so background work never competes with conversations for more than one slot.
- Jobs start after storage and migrations are ready. On shutdown no new runs start; running ones are aborted and awaited for a bounded time (5 seconds).

## State and reporting

State is in memory only and rebuilt on start:

| Per job   | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `status`  | `idle`, `running`, `failing` (the last run failed; backing off) |
| `lastRun` | Start, duration, outcome (`ok` with summary, or error message)  |
| `nextRun` | When it runs next (absent while running)                        |

- **Settings.** The Background jobs page lists each job with its state and a **Run now** action, which queues a run immediately unless the job is running or queued. Every state change publishes `backgroundJobs.changed` with the job.
- **Activity bell.** Routine runs stay out of the bell. A job reports what the user must act on as a producer-owned notice through `ActivityService.reportNotice` (`BackgroundJobNotices.report`, kind `background-job.<id>`) and clears it when resolved. A job that fails three times in a row shows a "keeps failing" notice linking to its Settings page, cleared by the next success.
- **Logs** carry the job id and message; never secrets.

## Account credential refresh

[`createCredentialRefreshJob`](../../packages/workbench-server/src/domains/accounts/credential-refresh-job.ts) keeps OAuth and extension-provider accounts signed in so a task does not meet an expired token ([accounts](extension-platform.md#credential-vault)):

- Every 5 minutes it asks the vault to refresh accounts that are `ready`, expire within 10 minutes and were used in the last 30 days (`last_used_at`), one by one, through the vault's single-flight refresh. Rows without a refresh token are skipped.
- Summary: how many were refreshed of how many were due, how many need sign-in, how many were unreachable (transient; the row is unchanged and the next sweep retries).
- An account that becomes `needs_sign_in` or `failed` gets a notice naming it, linking to the Accounts page. The notice is cleared when the account is ready again or deleted.

## Later jobs

Each needs its own design. They fit the mechanism as sweeps: scheduled workflows (start the workflows due since the last run; needs workflow files, permissions for unattended runs and notification), extension background work (needs manifest declaration, consent and sandbox limits), git fetch for open projects (fits [workspace sync](../../packages/workbench-server/src/domains/git/workspace-sync/git-workspace-sync-service.ts)) and maintenance (artifact retention, cache cleanup). When a later job is user-configurable, the page gains an on/off switch for it.
