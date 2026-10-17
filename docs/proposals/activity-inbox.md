# Activity inbox

> Approved in-memory first version; the activity foundation is implemented, with shared Git/completion integration still in progress. See [implementation status](#implementation-status-2026-10-18) for delivered behavior and visual verification. **No database schema change or persistence**. Pairs with [concurrent Git operations](git-operations.md).

## Goal

Give the application one place that answers: _what is running, what finished, and what failed?_ Examples include pulling a repository, fetching several repositories, cleaning storage, checking out a PR or deleting a project.

These are in-app activities, not desktop/OS notifications. The model is similar to the background-tasks and notifications areas in IntelliJ or DBeaver.

## Previous behavior

- **Maintenance** (storage cleanup, conversation pruning, project deletion) already has queued/running/terminal status, phase, progress counters, warnings, errors and cancellation (`packages/contracts/src/domains/maintenance/`, `workbench-server/src/domains/maintenance/`). It only keeps the **latest** operation, in memory, and it appears only in Settings → Storage.
- **Notices** (`workbench-notice-publisher.ts`) are best-effort and have no replay.
- **Toasts** (`svelte-sonner`, `application/notifications/notify.svelte.ts`) are transient; a missed toast is lost.
- **Git** mutations report nothing on failure beyond the awaited response, and nothing while running.
- The titlebar (`app/shell/Titlebar.svelte`) shows Discover, optional Logs and Settings. The Discover badge is for product updates/setup.

There was no shared concept of an "activity" across these producers.

## Approved design

### Name and placement

Call it **Activity**. Place an icon button in the titlebar immediately left of Discover.

- While work is running, the icon shows a subtle spinner/progress ring and a running count.
- When an activity fails and has not been seen, the icon shows a `destructive` dot.
- Otherwise it is quiet.

Clicking opens a popover with two sections:

1. **Running** — title, scope (project/repository), phase, progress bar (determinate or indeterminate), elapsed time, and **Cancel** when supported.
2. **Recent** — succeeded, failed, cancelled and interrupted activities, newest first. Failures expand to show the error message and actions such as **Retry**, **Open repository** or **View logs**. **Clear** removes finished entries.

Toasts remain for immediate feedback. A failure toast says what failed and links to the entry; the inbox is the durable record within the session.

### Activity model (shared contract)

Defined once in `packages/contracts`, transport-neutral:

| Field                                   | Meaning                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`, `parentId?`                       | Identity; parents group bulk work (for example "Fetch all" → one child per repository).                 |
| `kind`                                  | Producer-defined, for example `git.pull`, `storage.cleanup`.                                            |
| `title`, `scope`                        | Human label and context (`projectId`, repository path).                                                 |
| `status`                                | `queued`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`.                                 |
| `phase`, `message`                      | Current step in plain language.                                                                         |
| `progress?`                             | `{ completed, total }` or absent for indeterminate.                                                     |
| `startedAt`, `updatedAt`, `finishedAt?` | Timing.                                                                                                 |
| `error?`                                | Safe, user-readable message and category; never credentials, environment values or full command output. |
| `actions`                               | Capabilities such as `cancel`, `retry`, `open`.                                                         |

Operations:

- `activity.list` — current snapshot (running + recent).
- `activity.cancel`, `activity.retry`, `activity.dismiss`, `activity.clear`.
- Event `activity.updated`, coalesced per activity ID so rapid progress updates do not flood clients.

### Server ownership

An `ActivityService` in `workbench-server` owns the registry, coalescing and retention. Producers report through a small port:

```ts
const activity = activities.start({
  kind: "git.pull",
  title: "Pull api-server",
  scope,
});
activity.progress({
  phase: "Receiving objects",
  progress: { completed: 42, total: 100 },
});
activity.succeed(); // or activity.fail({ message: safeMessage }) / activity.cancelled()
```

`start(input, { cancel?, retry? })` accepts an optional producer-supplied ID, queued/running status, scope and parent ID. The cancellation callback requests safe cancellation and can refuse with `false`; only the producer calls `cancelled()` once cancellation really completes. The retry callback starts a fresh authorized operation and returns its activity ID. `progress` can change cancellation availability through `cancellable`. No action callback means no corresponding action is exposed.

Producers keep their own lifecycle and policy. Activity is a reporting surface, not a scheduler:

- **Git operations** report through it (see [git-operations.md](git-operations.md)).
- **Maintenance** becomes one producer. It keeps its own service and single-operation exclusivity; Settings → Storage can continue to read maintenance state.
- Later candidates: PR checkout/merge, project scans, native index builds that take noticeable time, launch failures.

### Retention

| Option                                           | Survives UI reload | Survives daemon restart                                                   | Cost                                      |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------- | ----------------------------------------- |
| **A. In-memory ring buffer (recommended first)** | Yes                | No; the client marks previously observed missing running work interrupted | No schema or files                        |
| B. Append-only JSONL under the Nerve home        | Yes                | Yes                                                                       | File rotation/cleanup; no schema          |
| C. Database table                                | Yes                | Yes                                                                       | Schema change; requires explicit approval |

**Decision:** use A (for example, the last 200 finished activities plus all running ones). History is not kept across daemon restarts. B is a possible later extension; C is not proposed.

### UI ownership

- Transport-neutral contracts/catalog: `packages/contracts`; existing protocol buffering coalesces `activity.updated` by `activity.id` (`latest_by_scope`). No new protocol mechanism.
- Client state that subscribes to `activity.updated`: `$lib/application/activity/`.
- Titlebar wiring: `$lib/app/shell/` and composition; the presentational popover lives in `$lib/presentation` and receives data and callbacks only.
- Use shadcn-svelte `Popover`, `Button`, `Progress`, `Badge`, `ScrollArea`, and Lucide icons; theme tokens `success`, `warning`, `destructive`, `info`.

## Phasing

1. Contracts, `ActivityService` (in-memory), titlebar popover with Running/Recent.
2. Git operation producer, including failures.
3. Maintenance adapter; failure toasts link to entries.
4. Additional producers as needed.

## Decisions

- **Retention:** in memory only (option A); no history across daemon restarts.
- **Scope:** Running and Recent show activities from **all projects**. Each entry shows its project/repository scope.
- **Successes (resolved):** remain visible until explicit dismissal/clear or oldest-finished eviction; no auto-hide timer. Whether to hide successes automatically is no longer an open question.

## Implementation status (2026-10-18)

- Shared `@nervekit/contracts/activity` schemas, five operations and ephemeral `activity.updated` events are implemented. Removal events carry the removed activity plus `removed: true` with an advanced revision, including clear and retention eviction.
- `ActivityService` reports lifecycle through a producer port, retaining 200 finished entries plus all running entries across projects. Producer-owned cancel/retry callbacks determine capabilities and actual outcomes; accepting cancellation never fabricates cancelled completion. Retry must use the producer’s normal permission/approval path. Disposal interrupts remaining running records.
- Maintenance mirrors into activities without changing its exclusive destructive lane, cancellation policy or existing Settings state/behavior. Destructive maintenance has no generic retry action.
- The right-side titlebar Activity/Bell button sits immediately left of Discover. Its popover uses the shared project-picker popover primitives, Running/Recent sections, scope labels, errors and keyboard-accessible action buttons. Running count and unseen failure indicator remain separate from Discover. Accepted live failures provide a toast action opening Activity unless the popover is already open; maintenance retains its existing notification to avoid duplicate toasts. Failures expose keyboard-accessible expandable error details while summary/status/actions remain visible. New failures arriving while open are marked seen; stale/duplicate/tombstoned events cannot announce failures.
- Subscription and first snapshot wait for progressive startup. Reconnect snapshots buffer concurrent events and compare revisions; previously observed running work absent from the new snapshot becomes a client-local interrupted record with no fabricated retry capability. The daemon cannot reconstruct lost history.
- Session history survives UI reload only while retained by the same daemon; locally inferred interruptions do not survive another UI reload. Producer error messages must be sanitized before reporting (no credentials, environment values or raw command output).
- Unit coverage exercises retention, lifecycle, real cancellation outcomes, retry/error/concurrency races, stale handles, snapshot/event ordering, removal and disposal. Global validation is serialized by the lead.

### Visual verification

Verified on Linux x64 / headless Chromium 151 using only the gitignored mock route `/dev/wireframes/activity-inbox`, production `Titlebar`/`ActivityPopover`, and synthetic activity fixtures. Light and dark modes show Activity in the actual right-side header cluster immediately left of Discover; the canonical icon control measures 28 × 28 px. Running count, unseen failure indicator, scope labels, progress and retained success state were checked. Enter/Space open the popover, Escape restores trigger focus, Tab reaches error details, Enter expands/collapses details, and keyboard Retry/Cancel invoke mock actions. The popover keeps summary/status/actions visible with one scroll region and pinned header/footer. No browser errors or daemon/API requests were observed. Local screenshots and interaction evidence are under `/tmp/nerve-activity-visual/` (not committed). This is synthetic visual/manual-browser verification, not a live producer or cross-platform test; desktop window chrome, coarse pointers and other viewport sizes remain unverified.
