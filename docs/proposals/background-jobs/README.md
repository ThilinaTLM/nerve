# Background jobs

**Status:** Draft · **Area:** daemon, settings

The daemon gets one way to run work that no request or conversation started. A **background job** is a named piece of daemon work that runs periodically, and Settings shows every job with its state. The first and, for now, only job is **account credential refresh**. Later jobs (scheduled workflows, extension background work, git fetch for open projects, maintenance) use the same mechanism.

Related: [extension accounts](../extension-accounts/README.md#token-refresh) (the first job), [conversation state and attention](../../architecture/conversation-state-and-attention.md) (the Activity bell), [`ActivityService`](../../../packages/workbench-server/src/domains/activity/activity.service.ts), [settings UI](../../ui/settings.md).

## Problem

- **Nothing runs on its own.** Work happens only when a request, a conversation or a launch starts it. The only recurring timer in the server is infrastructure (the daemon lease heartbeat).
- **OAuth sign-ins expire unnoticed.** Without refresh ahead of time, the first sign of an expired or revoked sign-in is a failed request in the middle of a task.
- **Future features need the same thing.** Each would otherwise grow its own timers, with its own handling of sleep, shutdown, failures and visibility.

## Goals

- One mechanism for every kind of background work in the daemon.
- Correct across sleep, wake, clock changes, restarts and shutdown.
- Bounded: per-run time limit, no overlapping runs, backoff on failure.
- Visible: a Settings page lists the jobs with their last and next run; problems the user must act on reach the Activity bell.
- No persisted scheduler state; jobs read their own domain's state.

## Non-goals

- Running while the daemon is stopped. Background work runs only while a daemon runs (always for a hosted daemon; on the desktop while the window is open or Nerve is in the tray). Starting a daemon at login is not planned.
- Scheduled workflows, extension background work and other later jobs themselves; each gets its own proposal. Scheduled workflows are expected to store their definitions as files, like [launch definitions](../../architecture/launch-definitions.md).
- Agent, `quick_script` or extension access to jobs.

## Design

### Jobs

A job is registered once at daemon start:

| Field                  | Meaning                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `id`                   | Stable (`accounts.credential-refresh`).                                             |
| `label`, `description` | Shown in Settings.                                                                  |
| `interval`             | Time between runs (`5m` for credential refresh).                                    |
| `timeout`              | Per run; the run's abort signal fires when it passes.                               |
| `run(signal)`          | One sweep. Returns a short summary for Settings (`Refreshed 2 accounts`) or throws. |

A job is a **sweep**, not a queue of individual work items: each run looks at its domain's state and does whatever is due. Credential refresh selects the accounts that expire soon and were used recently, and refreshes them. _Why:_ the domain's state is the single source of truth, so nothing has to be registered, updated or removed when an account changes, and a restart needs no recovery. Work that must happen at an exact moment (a workflow at 09:00) can still be expressed as a sweep that runs what is due since the last run; a later client that needs finer timing can add it then.

### Timing

- **Wall clock.** Each job has a next-run time. A single ticker checks every 30 seconds and starts jobs whose time has passed. Long `setTimeout`s are not used, because they drift across sleep and ignore clock changes.
- **After sleep or start.** A job that came due while the machine slept runs once on the next tick, not once per missed interval. On daemon start, jobs run on the first tick after storage is ready.
- **Failures.** A run that throws or times out is retried with exponential backoff (capped at the interval); the next success resets it.

### Limits

- One run per job at a time; a job still running when it comes due again is not started twice.
- Every run has a timeout.
- Jobs run one after another, so background work never competes with conversations for more than one slot.

### Lifecycle

- Jobs start after storage and migrations are ready.
- On shutdown, no new runs start; running ones are aborted and awaited for a bounded time.

### State and reporting

In memory only, rebuilt on start:

| Per job   | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `status`  | `idle`, `running`, `failing` (the last run failed; backing off) |
| `lastRun` | Start, duration, outcome (`ok` with summary, or error message)  |
| `nextRun` | When it runs next                                               |

- **Settings.** A **Background jobs** page lists each job as a `SettingsItem`: label, description, status, last run (time and summary or error) and next run, with a **Run now** action. Run now starts a run immediately unless one is running. Operations: `backgroundJobs.list` and `backgroundJobs.runNow`; changes publish `backgroundJobs.changed`. Like other user-UI operations, they are not reachable by agents or extensions.
- **Activity bell.** Routine runs stay out of the bell. A job reports what the user must act on as a producer-owned notice through `ActivityService.reportNotice` (an account that needs sign-in), and clears it when resolved. A job that keeps failing shows as a notice linking to its Settings entry.
- **Logs** carry the job id and message; never secrets.

## First job: account credential refresh

Defined in [extension accounts](../extension-accounts/README.md#token-refresh):

- Every 5 minutes, query the `account` table for accounts that expire within 10 minutes and were used in the last 30 days (`last_used_at`), and refresh those with a refresh token one by one through the vault's single-flight refresh.
- Summary: how many were refreshed, how many need sign-in.
- An account that becomes `needs_sign_in` or `failed` gets a notice naming it, with a link to the Accounts page.

## Later jobs

Each needs its own proposal; listed to check that the mechanism fits.

| Job                                                           | Fits as                                                   | Needs elsewhere                                                                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled workflows                                           | A sweep that starts workflows due since the last run      | Workflow files, permissions for unattended runs, results and notification                                                                |
| Extension background work (poll an API, keep a panel current) | One job per enabled extension task, or one sweep over all | Manifest declaration and consent, sandbox limits, results through the extension store (`extensionStoreChanged` already reaches frames)   |
| Git fetch for open projects                                   | A sweep over open projects' repositories                  | Fits with the existing [workspace sync](../../../packages/workbench-server/src/domains/git/workspace-sync/git-workspace-sync-service.ts) |
| Maintenance (artifact retention, cache cleanup)               | A daily sweep                                             | Retention settings                                                                                                                       |

When a later job is user-configurable, the Settings page gains an on/off switch for it; credential refresh has none, because turning it off only makes sign-ins expire.

## Documentation to update

On implementation: a new architecture page `docs/architecture/background-jobs.md` (this design, without the proposal parts), [settings UI](../../ui/settings.md) for the new page, and the website's settings reference. This proposal is deleted once implemented.

## Phases

1. Job registry, ticker, limits, lifecycle, Settings page and the credential refresh job. Needs phase 1 of [extension accounts](../extension-accounts/README.md#phases) (the `account` table and refresh on use) first.
2. Later jobs, each with its own proposal.
