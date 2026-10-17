# Activity inbox

> Proposal for discussion; not yet approved. The recommended first version needs **no database schema change**. Pairs with [concurrent Git operations](git-operations.md).

## Goal

Give the application one place that answers: _what is running, what finished, and what failed?_ Examples include pulling a repository, fetching several repositories, cleaning storage, checking out a PR or deleting a project.

These are in-app activities, not desktop/OS notifications. The model is similar to the background-tasks and notifications areas in IntelliJ or DBeaver.

## Current behavior

- **Maintenance** (storage cleanup, conversation pruning, project deletion) already has queued/running/terminal status, phase, progress counters, warnings, errors and cancellation (`packages/contracts/src/domains/maintenance/`, `workbench-server/src/domains/maintenance/`). It only keeps the **latest** operation, in memory, and it appears only in Settings → Storage.
- **Notices** (`workbench-notice-publisher.ts`) are best-effort and have no replay.
- **Toasts** (`svelte-sonner`, `application/notifications/notify.svelte.ts`) are transient; a missed toast is lost.
- **Git** mutations report nothing on failure beyond the awaited response, and nothing while running.
- The titlebar (`app/shell/Titlebar.svelte`) shows Discover, optional Logs and Settings. The Discover badge is for product updates/setup.

There is no shared concept of an "activity" across these producers.

## Proposal

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
activity.progress({ phase: "Receiving objects", completed: 42, total: 100 });
activity.succeed(); // or activity.fail(error) / activity.cancelled()
```

Producers keep their own lifecycle and policy. Activity is a reporting surface, not a scheduler:

- **Git operations** report through it (see [git-operations.md](git-operations.md)).
- **Maintenance** becomes one producer. It keeps its own service and single-operation exclusivity; Settings → Storage can continue to read maintenance state.
- Later candidates: PR checkout/merge, project scans, native index builds that take noticeable time, launch failures.

### Retention

| Option                                           | Survives UI reload | Survives daemon restart                                  | Cost                                      |
| ------------------------------------------------ | ------------------ | -------------------------------------------------------- | ----------------------------------------- |
| **A. In-memory ring buffer (recommended first)** | Yes                | No; running work is reported as interrupted on reconnect | No schema or files                        |
| B. Append-only JSONL under the Nerve home        | Yes                | Yes                                                      | File rotation/cleanup; no schema          |
| C. Database table                                | Yes                | Yes                                                      | Schema change; requires explicit approval |

**Decision:** use A (for example, the last 200 finished activities plus all running ones). History is not kept across daemon restarts. B is a possible later extension; C is not proposed.

### UI ownership

- Contracts and protocol: `packages/contracts`.
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

## Open questions

- Should successful activities be hidden after a short time, leaving only failures in "Recent"?
