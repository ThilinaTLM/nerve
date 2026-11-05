# Workbench app: shared primitives and component decomposition

> **Status:** Proposal. Covers `packages/workbench-app` and `packages/ui-kit`. Follow `packages/workbench-app/AGENTS.md`: `presentation/` may import only presentation-local modules, contracts and ui-kit; `*Host` components are state/effect adapters; features never import features.
>
> A reactive `createClock` already exists (`src/lib/presentation/clock/clock.svelte.ts`, backed by `clock-ticker.ts`). It is referenced here as given and is not redesigned.

Four independent changes, ordered by payoff-to-risk. None touches storage or the protocol.

---

## A. `FormDialog` as a ui-kit composite

### Problem

`features/settings/views/shared/settings-form-dialog.svelte` wraps the ui-kit `dialog-shell` composite with the standard form chrome: body grid, optional error line, Cancel + primary Save buttons, busy spinner. It is used only by `AtlassianAccountDialog.svelte` and `TavilyAccountDialog.svelte`.

Meanwhile 31 files import `dialog-shell` and most form dialogs rebuild the same footer by hand:

- `features/launches/views/LaunchDefinitionDialog.svelte` (footer ~line 201): ghost Cancel with `disabled={saving}` + primary with `"Saving…"` label.
- `features/launches/views/LaunchFolderDialog.svelte` (~108): same pair.
- `features/projects/views/PruneConversationsDialog.svelte` (~151): Cancel via `handleOpenChange(false)` + primary.
- `features/git/views/GitBranchDialog.svelte` (~262): two views, each with Cancel/primary footers.
- Others with a likely identical shape to audit: `GitStashDialog`, `CreatePromptSuggestionDialog`, `PermissionRuleDialog`, `AddProviderDialog`, `CustomProviderDialog`, `ModelDefinitionDialog`, `ToolConfigDialog`, `ConversationListSettingsDialog`.

The cost is drift: busy/disabled handling, "Saving…" vs spinner, Enter-to-submit, and error placement differ per dialog.

### Proposal

Move the component to `packages/ui-kit/src/lib/components/composites/form-dialog/` (same layout as `confirm-dialog`, `dialog-shell`) and add the two features the hand-rolled dialogs need:

```ts
interface FormDialogProps {
  open?: boolean; // $bindable
  title: string;
  description?: string;
  size?: "sm" | "md"; // pass-through of dialog-shell sizes; no new size level
  submitLabel: string;
  submitDisabled?: boolean; // validation; separate from busy
  busy?: boolean; // disables both buttons, shows Spinner
  error?: string;
  closeOnInteractOutside?: boolean;
  onSubmit(): void | Promise<void>;
  onCancel?(): void; // default: open = false
  children: Snippet; // form body
  footerLeading?: Snippet; // e.g. a destructive secondary action
}
```

- Wrap the body in a real `<form onsubmit>` so Enter submits and `type="submit"` is the primary action. This replaces today's per-dialog `onkeydown` handling.
- Keep `bodyClass`, `errorClass`, `*TourId` only if the two current callers still need them; otherwise prefer a single `data-tour-id` pass-through.
- Do not add button size levels or class-patching (AGENTS: two control height tokens only).

### Migration

1. Move the file to ui-kit, update the two callers, delete the settings-local copy.
2. Migrate single-form dialogs first (`LaunchFolderDialog`, `LaunchDefinitionDialog`, `PruneConversationsDialog`), one PR each so reviews are mechanical.
3. `GitBranchDialog` has two views with different footers; leave its custom footer on `dialog-shell` unless one view fits cleanly. Dialogs that are not forms (details/report viewers, `QuickOpenDialog`, history) stay on `dialog-shell`.
4. Add a ui-kit component test (see `testing-improvements.md`, Svelte component layer): submit on Enter, busy disables both buttons, Cancel closes.

### Deleted / simplified

About 10-20 lines of footer markup per migrated dialog and the inconsistent busy states; the settings-local wrapper.

---

## B. `createPoll` primitive

### Problem

At least four independent polling loops each re-implement start/stop, in-flight guards and (inconsistently) visibility handling:

| Site                                                                          | Mechanism                                                                                                      | Gaps                                                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `features/releases/state/release-polling.svelte.ts`                           | module `setInterval` (1 h) + `refreshing` flag                                                                 | Runs while hidden; module-level singletons                                             |
| `platform/pwa/pwa-update-scheduler.ts`                                        | `window.setInterval`, `focus`/`online`/`visibilitychange` listeners, `minimumCheckIntervalMs`, `checkInFlight` | Best implementation; the one to generalise                                             |
| `application/startup/workbench-client.svelte.ts` (`usageTimer`, ~line 112)    | `setInterval` 10 s for `refreshSubscriptionUsage`, cleared in `disconnectWorkbench`                            | Polls every 10 s regardless of whether any panel shows usage; swallows errors silently |
| `application/maintenance/maintenance-controller.ts` (`schedule()`, ~line 133) | `setTimeout` 2.5 s re-armed after each `load`, only while the operation is active                              | Self-contained but duplicates in-flight/reload bookkeeping                             |

`application/monitoring/workspace-monitor-demand.ts` already models "demand" for the workspace monitor, so the concept exists for subscriptions but not for polls.

### Proposal

A small framework-neutral primitive in `platform/` (not `presentation/`, since it touches timers and `document`), with an optional rune wrapper for components. `createClock` stays the reactive "now" source; `createPoll` is the side-effecting "run this".

```ts
// platform/polling/poll.ts
export interface PollOptions {
  run(signal: AbortSignal): Promise<void> | void;
  intervalMs: number | (() => number | undefined); // undefined/0 = paused (cf. createClock)
  /** Only tick while true; e.g. () => usageVisible or panel demand count > 0. */
  enabled?: () => boolean;
  /** Pause while the document is hidden; resume (and run once if stale) on visible/focus/online. */
  whileVisible?: boolean; // default true
  minGapMs?: number; // coalesce focus/visibility storms (pwa scheduler's 60 s)
  immediate?: boolean; // run on start
  onError?(error: unknown): void; // default: clientLog("warn")
  clock?: { now(): number; setTimeout; clearTimeout }; // injected for tests
}
export interface Poll {
  start(): void;
  stop(): void;
  trigger(): Promise<void>;
  readonly running: boolean;
}
export function createPoll(options: PollOptions): Poll;
```

Design points: one in-flight run at a time (a `trigger()` during a run marks one follow-up); `setTimeout` re-arming rather than `setInterval` so slow runs never overlap; the `AbortSignal` is aborted on `stop()`; time and visibility sources injected so tests use a fake clock (same pattern as `protocol/test/streams/latest-snapshot-delivery.test.ts`).

### Migration

1. Implement `createPoll` by lifting `pwa-update-scheduler.ts` logic, keep its tests (they already inject `window`/`document`/`now`) and re-point them to the new primitive; `startPwaUpdateScheduler` becomes a 10-line adapter.
2. Convert `release-polling.svelte.ts` (smallest) and `workbench-client` usage polling. For usage, drive `enabled` from a demand counter (the usage UI registers while mounted) in the style of `workspace-monitor-demand.ts` so it stops polling when nothing displays it. **Needs product confirmation**: does anything outside the settings UI depend on fresh subscription usage (e.g. a status bar or quota warnings)?
3. Convert `MaintenanceController.schedule()`: `enabled: () => isMaintenanceActive(this.operation)`, `intervalMs: 2500`.

### Deleted / simplified

Four hand-written timer/in-flight state machines; module-level `refreshTimer`/`refreshing`/`usageTimer`; the manual `clearTimeout` bookkeeping in `MaintenanceController.dispose`.

---

## C. Shared controller lifecycle shell

### Problem

Three controllers share the same lifecycle skeleton but not the same domain logic:

- `application/activity/activity-controller.ts` (278 lines): `#unsubscribe`, `#generation`, `start()` (idempotent), `dispose()`.
- `application/maintenance/maintenance-controller.ts` (138 lines): `#started`, `#generation`, `#unsubscribe`, `start()`/`dispose()`/`reconnect()`.
- `features/settings/views/pages/storage/storage-page-state.svelte.ts` (74 lines): `#generation`, `#unsubscribe`, `start()` that calls `dispose()` first, generation-guarded async load.

Each hand-rolls "bump a generation to invalidate in-flight async work, drop the subscription, make `start` idempotent". `storage-page-state` differs subtly (start-after-dispose restarts; it reads `#generation` _after_ `dispose()` increments it), which is exactly the kind of variation a shared shell should settle once.

### Proposal: lifecycle only

```ts
// platform/lifecycle/controller-lifecycle.ts
export class ControllerLifecycle {
  start(setup: (scope: LifecycleScope) => void): boolean; // false if already started
  dispose(): void;
  restart(setup): void;
  get started(): boolean;
}
export interface LifecycleScope {
  readonly generation: number;
  isCurrent(): boolean; // `scope.isCurrent()` replaces `generation === this.#generation`
  onDispose(cleanup: () => void): void; // unsubscribe, clearTimeout, poll.stop()
  guard<T>(promise: Promise<T>): Promise<T | undefined>; // resolves undefined if superseded
}
```

Controllers compose it (`#life = new ControllerLifecycle()`); they do not extend a base class.

**Explicit non-goal:** reconciliation. `ActivityController`'s subscribe-before-snapshot buffering, tombstones, notices, and local interruptions; `MaintenanceController`'s `#reload`/`#terminal` bookkeeping; and storage's usage loading are domain-specific and stay where they are. Do not try to generalise "snapshot + live updates" in this change.

### Migration

Convert `StoragePageController` first (smallest, clearest bug-prone ordering), then `MaintenanceController` (uses `onDispose(poll.stop)` once B lands), then `ActivityController`. Existing controller tests are the net; add one small test for `ControllerLifecycle` (idempotent start, stale-scope guard after dispose).

### Deleted / simplified

About 10 lines of lifecycle fields and checks per controller; all manual `generation` comparisons.

---

## D. Decomposing the three oversized components

Line counts today: `app/composition/centers/ConversationCenterHost.svelte` 1139 (script 1-938), `features/filesystem/hosts/FilesPanelHost.svelte` 1109 (script 6-1043), `presentation/tools/ToolCallCard.svelte` 845 (script 1-692; the brief said 852, current file is 845).

General rule: split by _responsibility_ into plain `.svelte.ts` state modules (hosts) or derived-view helpers (presentation) and keep the `.svelte` file as wiring. Do not create wrapper components that only forward props.

### `ConversationCenterHost.svelte`

The script mixes (a) composer wiring, (b) prompt submission, (c) interaction resolution, (d) queued-prompt/edit actions, and (e) pane navigation. Seams visible from the function list:

- `conversation-center/prompt-submission.svelte.ts`: `submitPrompt` (line ~528, ~110 lines), `applySuggestion`, `sendSuggestion`, `setPaneComposerText`, `runActivePaneAction`, `abortActiveRun`, `retryActiveResponse`.
- `conversation-center/interaction-actions.svelte.ts`: `resolve`, `answerUserQuestion`, `dismissUserQuestion`, `grantApproval`, `denyApproval`, `acceptPendingPlanReview`, `rejectPendingPlanReview` (lines ~726-820). Natural fit for the plan in `interaction-handlers.md` on the client side.
- `conversation-center/queued-prompts.svelte.ts`: `forcePushQueuedPrompts`, `discardQueuedPrompt`, `moveQueuedPromptToComposer`, `editConversationEntry`.
- `conversation-center/composer-config.svelte.ts`: `setComposerModelSelection`, `resetComposerPermission`, `setComposerAgentProfile`, `setComposerPermissionRuleSet`, `compactActiveConversation`, `openSystemPrompt`.

The `.svelte` file keeps template + construction of these modules from the pane context. These stay under `app/composition` (they wire features together, which only that layer may do).

### `FilesPanelHost.svelte`

Clear subsystems already visible by function prefix:

- Tree + selection + keyboard: `activate`, `setExpanded`, `collapseAll`, `extendSelection`, `handleItemClick`, `handleItemKeydown`.
- Edit/clipboard operations: `requestCreate`, `requestRename`, `commitEdit`, `setClipboard`, `pasteInto`, `duplicate`, `requestDelete`, `confirmDelete`.
- Drag & drop and upload: `startEntryDrag` … `performDrop`, `uploadFiles`, `confirmReplace` (~lines 695-875, ~180 lines, almost self-contained).
- Context menus: `launchMenu`, `rootMenu`, `itemMenu`.
- Data: `refreshDirectories`, `refreshGitStatus`, `refreshAll`, `syncMonitorDemand`.

Extract into `features/filesystem/state/`: `files-tree-drag.svelte.ts` (largest, most isolated), `files-entry-operations.svelte.ts`, and `files-context-menu.ts` (pure function of entry + capabilities, easily unit-testable). Start with drag-and-drop and menus; they have the fewest ties to the rest.

### `ToolCallCard.svelte`

The script is ~70 `$derived` values with a few functions. Many of them describe the _presentation model_ of a call independent of markup:

- Argument/draft streaming (`pacingArgs`, `presentedDraftBlock`, `argumentLifecycleStage`, `lifecycleArgumentPresentation`, `draftSummary`, `hasMeaningfulDurableBody`, lines ~214-372).
- HIL/approval/ask-user/plan-review derived state (lines ~376-421).
- Lifecycle/timing/stage and meta (lines ~443-565: `startedAtMs`, `clockRunning`, `lifecycleStage`, `visualStage`, `meta`, `badge`).

Move these into `presentation/tools/tool-call/` as pure functions or one `createToolCallCardModel(props)` returning derived getters. They depend only on presentation-local types, so layering holds. The clock (`createClock`, line ~459) stays in the component since it is a component-lifecycle effect. Pure-function extraction also makes the stage and draft logic unit-testable without mounting.

### Sequencing and guardrails

One extraction per PR, behavior-preserving; no visual change, so no new screenshots required. Respect the "no wrapper components, no presentation markup recreated in hosts" rules.

---

## Risks & open questions

- **Dialog Enter-to-submit** via `<form>` can double-fire with dialogs that already handle Enter in a text field; audit each migrated dialog.
- **Where to host `createPoll`**: `platform/` is correct for layering but `release-polling` lives under `features/`, which may import `platform`. Confirm `platform` does not import `application` (it must not).
- **Usage polling demand** (B.2) is a behavior change and needs a product decision.
- **No DB/storage/protocol changes** anywhere in this proposal.

## Effort

- A: S-M (half a day for the component, 1 hour per migrated dialog).
- B: M (1-2 days including fake-clock tests).
- C: S (half a day, 3 controllers).
- D: L overall, but incremental: each extraction is S-M and independent.
