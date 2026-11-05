# Testing improvements

> **Status:** Proposal. Test-only changes plus one dev-tooling addition (unused-export baseline). No product code or storage changes. Governing rule is the root `AGENTS.md`: run unit tests for touched code; add tests for important behavior only, never for exports, pass-through adapters, cosmetics, or behavior covered at its owning layer.

Five areas, in priority order.

---

## 1. Direct unit tests for protocol modules

### Problem

`packages/protocol/test/` has tests for connections, RPC concurrency, sessions, and some streams (`dense-event-stream`, `latest-snapshot-delivery`, `notification-buffer`, `subscription-recovery`, `terminal-notification-order`). Six small modules that hold the actual buffering, replay and de-duplication rules have **no direct test** and are covered, if at all, only incidentally through bigger flows:

| Module                                  | Lines | Responsibility worth pinning                                                              |
| --------------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| `src/rpc/idempotency-store.ts`          | 114   | TTL/eviction of completed results, in-flight de-duplication, same key + different payload |
| `src/streams/live-event-buffer.ts`      | 48    | Buffering events during replay, ordering, overflow behavior                               |
| `src/streams/priority-sender.ts`        | 67    | Priority ordering across classes, no starvation, error propagation                        |
| `src/streams/event-batch.ts`            | 68    | Batch boundaries by count/bytes, flush on timer                                           |
| `src/streams/outgoing-buffer-budget.ts` | 27    | Reserve/release accounting, rejects over budget, never negative                           |
| `src/adapters/browser-id-store.ts`      | 38    | Stable id per storage, regenerates when storage is empty/corrupt/throws                   |

They are small, pure and clock-driven, which makes them cheap to test well and the most valuable place to catch regressions in reconnect and backpressure behavior.

### Approach

Reuse the fixture pattern from `protocol/test/streams/latest-snapshot-delivery.test.ts`: a manual `now`, a `Map` of fake timers, an `advance(ms)` that fires due timers in order, and injected `clock`/`timers` objects. Extract it once into `protocol/test/support/fake-clock.ts` (the file already inlines it) and use it from the new tests and from `latest-snapshot-delivery.test.ts`. If a module reads `Date.now()`/`setTimeout` directly (check `idempotency-store.ts` and `event-batch.ts`), add an optional injected `clock`/`timers` option defaulting to the real ones; this follows the existing style in `latest-snapshot-delivery.ts` and is not a compat shim.

Test shape, one file per module under mirrored paths (`protocol/test/rpc/idempotency-store.test.ts`, `protocol/test/streams/*.test.ts`, `protocol/test/adapters/browser-id-store.test.ts`), keeping to 3-6 behavioral cases each, e.g.:

- `idempotency-store`: concurrent duplicates share one execution; entry expires after TTL (advance the fake clock); same key with a different payload is rejected rather than replayed; capacity eviction drops the oldest completed entry, never an in-flight one.
- `outgoing-buffer-budget`: sum of reservations never exceeds budget; release below zero is a no-op or throws (pin whichever it does).
- `browser-id-store`: pass a fake `Storage` that throws on `getItem`/`setItem`.

Run: `cd packages/protocol && pnpm exec tsx --test test/streams/event-batch.test.ts` etc.

**Effort:** S-M (about a day for six modules). **Risk:** pinning accidental behavior; keep to documented invariants and comment where a test pins a deliberate choice.

---

## 2. Replace fixed sleeps with `waitFor` or injected clocks

### Problem

Hard-coded sleeps make tests slow on a fast machine and flaky on a loaded CI runner. Verified current sites:

| File                                                                     | Sleeps                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `native/test/monitor/change-monitor.test.ts`                             | lines 36 and 219 (25 ms), line 172 `settle` = 600 ms                                          |
| `native/test/process/managed-process.test.ts`                            | lines 45 (20 ms), 182 (50 ms); child scripts also sleep 150/4000 ms in-process                |
| `native/test/files/files.test.ts`                                        | line 21 (25 ms), lines 78 and 81 (700 ms ×2, presumably waiting out an mtime/debounce window) |
| `tools/test/git/git-operations.test.ts`                                  | line 24 (2 ms; likely mtime ordering), 371-376 manual timeout race                            |
| `tools/test/execution/python.test.ts`                                    | lines 33 and 47 (10 ms), Python `time.sleep(0.25)` at 130                                     |
| `workbench-server/test/domains/launches/launch-service.contract.test.ts` | lines 269, 432 (0 ms microtask turns), 420 (5 ms), 462 (10 ms)                                |

Some sleeps are legitimate fixtures (a child process that must outlive a kill, `setTimeout(() => {}, 4000)` inside a spawned script) and should stay; the target is sleeps in the **test body that wait for the system under test**.

There is no shared helper: ad-hoc `waitFor`/`waitForProcessExit` copies already exist (`native/test/process/managed-process.test.ts:41`, a `waitFor` in `workbench-server/test/domains/auth/oauth-flow-manager.test.ts:42`, `workbench-server/test/domains/launches/launch-service-fixture.ts`).

### Approach

1. **One `waitFor` helper per test-support location**, not a new package: `native/test/support/wait-for.ts`, `tools/test/support/wait-for.ts`, and `workbench-server/test/support/wait-for.ts` (or one `tests` workspace-internal export if the architecture check allows cross-package test imports; it likely does not, so keep three small copies of ~15 lines, with a shared signature):

   ```ts
   export async function waitFor<T>(
     probe: () => T | undefined | false | Promise<T | undefined | false>,
     options?: { timeoutMs?: number; intervalMs?: number; message?: string },
   ): Promise<T>;
   ```

   It polls the condition with a generous timeout (default several seconds) and fails with `message` and the last probe error. Fast machines return as soon as the condition holds; slow ones still pass.

2. **Event-driven where possible**: for `change-monitor` and `files` watchers, await the callback/emitted event with a timeout instead of "sleep then assert".
3. **Injected clock where the time is the behavior**: debounce windows in `change-monitor` and the 700 ms waits in `files.test.ts` should use a `debounceMs` option (set to a few ms in tests) or the fake clock from item 1 rather than waiting out the production value. If the Rust-side native monitor owns the debounce and cannot be faked, document it and use `waitFor` with a negative check kept short (assert that no event arrives within N ms only where that absence is the behavior).
4. **mtime ordering sleeps** (`git-operations.test.ts:24`): set explicit file times with `utimes` instead of sleeping to get distinct timestamps.
5. **`launch-service.contract.test.ts`**: 0 ms turns are microtask flushes; name them (`flushMicrotasks()`) and replace the 5/10 ms waits with `waitFor` on the service state.

Do this one file at a time; each conversion is verified by running the file 20 times in a loop locally (`for i in $(seq 20); do …; done`) to confirm no flake.

**Effort:** M (about 1.5 days). **Payoff:** faster native suite (the 700 ms ×2 alone is 1.4 s per run) and fewer CI flakes.

---

## 3. Svelte component test layer for ui-kit primitives

### Problem

`packages/ui-kit` tests are plain `tsx --test "src/**/*.test.ts"` over pure logic (`list-navigation.test.ts`, `virtual-measurement.test.ts`, `sheet-swipe.test.ts`, `control-scale.test.ts`, …). None renders a Svelte component, so behaviors that live in component markup and runes have no test: dialog open/close and focus, `form-dialog`/`confirm-dialog` footer behavior, `switch-field` keyboard semantics, `select-field` value binding, `scroll-region` aria. The proposal in `workbench-app-shared-primitives.md` adds a `FormDialog` composite, which would be the first thing worth testing this way.

### Proposal

Add a minimal, opt-in component test layer to `ui-kit` (and not to `workbench-app`, which has its own 231 colocated tests and a `scripts/run-tests.mjs` runner):

- Runner: **Vitest + `@testing-library/svelte` + `jsdom`** (or `happy-dom`), with `@sveltejs/vite-plugin-svelte` for compilation, under `packages/ui-kit/vitest.config.ts`. Alternative: keep `tsx --test` and use Svelte's `mount()` with `jsdom` globals directly, with no new runner but more hand-rolled setup. Recommendation: Vitest, because `node:test` + the Svelte compiler needs a loader and we would be building a harness.
- Naming: `*.svelte.test.ts` next to the component, picked up by Vitest only; existing `*.test.ts` stay on `tsx --test` so current scripts and the focused-validation runner keep working. Add a `test:components` script in `ui-kit/package.json`; do **not** add it to default `test` until it has proven stable (AGENTS.md says suites run only on request).
- Scope: behavior of interactive primitives only. Explicitly **not** snapshot or class-name tests (AGENTS.md excludes cosmetics). First targets: `form-dialog` (Enter submits; busy disables both buttons), `confirm-dialog`, `switch-field`, `select-field`, `popover-panel` open/close and escape.
- jsdom limitations (layout, `ResizeObserver`, pointer capture) mean virtual-list and scroll behaviors stay on the existing pure tests; the browser suite (`test:browser`) remains the place for layout-dependent checks.

**Approval/caveat:** this adds dev dependencies and a config file in `ui-kit` (and may touch `scripts/checks/*` policy that enumerates test file patterns, `server-test-runtime-policy.mjs` / `focused-validation-selection.mjs`); both are outside this proposal's edits and need a maintainer decision before implementation.

**Effort:** M (tooling 0.5-1 day, then S per component).

---

## 4. One test-placement convention

### Problem

Placement differs by package, so it is hard to know where a new test goes or find an existing one:

| Package                                           | Layout today                                                    |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `native`, `harness`, `contracts`, `desktop-shell` | separate `test/` tree (15 / 29 / 41 / 26 files), none colocated |
| `conversation-core`, `workbench-app`              | colocated `*.test.ts` only (41 / 231), none in `test/`          |
| `tools`                                           | mostly `test/` (76) with 4 colocated                            |
| `workbench-server`                                | both: 75 under `test/` and 114 colocated in `src/`              |
| `protocol`, `ui-kit`                              | `protocol/test/`; ui-kit colocated                              |

`workbench-server` is the worst case: `src/core-host/*.test.ts` sit next to adapters while `test/domains/**` holds the domain tests, and integration/contract tests live under `test/`.

### Proposal

A rule that follows the existing majority per package and is cheap to enforce:

1. **Unit tests colocate** with the module as `<name>.test.ts` (matches `conversation-core`, `workbench-app`, `ui-kit`, and the `workbench-server/src/core-host` precedent). Rationale: AGENTS.md's unit-test command is per file, and colocated files make "touched code → its test" obvious and let the focused-validation selector map by directory.
2. **`test/` is for cross-module scenarios, contract tests, integration tests (`*.integration.test.ts`), fixtures and shared support** (`test/support/`). This keeps the current names that CI selects.
3. **Packages that already use `test/` for unit tests (`native`, `harness`, `contracts`, `desktop-shell`, most of `tools`, `protocol`) are not moved wholesale.** Mirror the source layout inside `test/` (as `protocol/test/streams/…` already does) and apply the colocation rule to new packages and to `workbench-server` going forward. A mass move would create pure churn and break blame, and is explicitly out of scope.
4. For `workbench-server`, new unit tests colocate; `test/domains/**` stays for service-level tests that need the shared fixtures there.
5. Document in `scripts/README.md` (or the package AGENTS files) and add a lightweight check only if drift recurs; a check that `*.test.ts` outside these locations fails is cheap, but it would need an allowlist for current exceptions, so defer.

**Effort:** S (documentation and convention; no code moves).

---

## 5. Audit pass-through core-host adapter tests

### Problem

Root `AGENTS.md` says not to test pass-through adapters or behavior covered at its owning layer. `packages/workbench-server/src/core-host/` holds adapters from conversation-core's ports to workbench-server services (`process.adapter.ts`, `tool-host.adapter.ts`, `turn-resources.adapter.ts`, `model.adapter.ts`, `permission.adapter.ts`) with colocated tests (`process.adapter.test.ts`, `tool-host.adapter.test.ts`, `turn-resources.adapter.test.ts`, `model.adapter.test.ts`, `permission.adapter.test.ts`, `permission.adapter.risk.test.ts`). Some of these likely assert that an adapter forwards arguments to a fake and returns its result, which duplicates the owning layer's tests and breaks whenever the port shape is refactored without catching real bugs.

### Proposal: an audit, not a rewrite

For each `*.adapter.test.ts` (and the `launch-tool`, `scoped-*` tests where adapters wrap services), classify every test case:

- **Keep**: encodes real translation logic or a policy decision made _in the adapter_ (for example `model.adapter.test.ts` "captured auxiliary model configuration resolves current secrets without reselecting endpoints or headers"; permission mapping in `permission.adapter.risk.test.ts`).
- **Delete**: only asserts delegation (call count/args forwarded to a stub, return value returned as is) when the callee has its own tests.
- **Move**: asserts behavior owned by another layer; relocate to that layer if untested there, else delete.

Record the result in the PR description as a table (file, test, verdict). Expect a net reduction in lines; do not add replacement tests. After deletions, run each touched file (`cd packages/workbench-server && pnpm exec tsx --test src/core-host/<file>.test.ts`).

**Effort:** S (half a day). **Risk:** deleting a test that guarded a real regression; mitigate by checking `git log -S` for the test name and keeping any with a bug-fix history.

---

## 6. Unused-export baseline (knip or ts-prune)

### Problem

Several proposals and AGENTS.md prefer deleting unused structure, but there is no tool in the repo that finds dead exports (no `knip`/`ts-prune` in the root `package.json`). Package `index.ts` barrels re-export freely, so unused exports accumulate silently.

### Proposal

- Add **knip** as a root dev dependency with a workspace-aware `knip.json` (entry points per package from `package.json` `exports`; Svelte + SvelteKit plugins for `workbench-app`/`ui-kit`). Prefer knip over `ts-prune`: it understands workspaces, exports maps, Svelte and unused files/dependencies, and `ts-prune` is unmaintained.
- **Baseline, do not gate.** First run produces a report; commit a `knip` baseline/ignore list so the check reports only _new_ unused exports. Run it as a manual script (`pnpm knip`) and in CI as non-blocking until the baseline is triaged. It must not be added to `check:focused` (the lead owns that selection and AGENTS.md says suites run on request).
- Triage in batches by package, starting with `contracts` (exports used only by tests are the main false-positive source: configure `entry` to include tests, or accept them as "used by test" explicitly).
- Be careful with public API surfaces enforced by `scripts/checks/package-export-surfaces.mjs` and `check-built-package-exports.mjs`: an export that is part of a documented package surface but unused internally must be `ignoreExportsUsedInFile`/allowlisted, not deleted.

**Needs maintainer decision:** adding a root dependency, the CI step, and the baseline file location. **Effort:** S for setup, then M of triage spread over time.

---

## Suggested order

1. Protocol unit tests (item 1) with the extracted fake clock: highest correctness value per line.
2. Sleep removal (item 2), starting with `native/test/files/files.test.ts` (longest waits).
3. Adapter test audit (item 5) and convention doc (item 4): cheap and mostly deletion/documentation.
4. Component layer (item 3) alongside the `FormDialog` work, then knip baseline (item 6).
