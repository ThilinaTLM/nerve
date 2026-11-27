# Code consolidation: shared primitives, retired fallbacks, one source of truth

Status: implemented on `refactor/code-consolidation` (one PR, all phases). See [Outcome](#outcome). Delete this file once merged (see [docs/README.md](../README.md#where-documentation-belongs)).

## Problem

Nerve grows feature by feature. Each feature is locally clean, but the same small mechanisms keep being rebuilt, older code paths stay alive next to their replacements, and existing helpers get bypassed by newer code.

A November 2026 audit (jscpd plus read-only reviews of every package, the Rust addon and the tests) found:

- **Literal copy-paste is low.** TypeScript 0.49% (2,019 of ~412k lines), Rust 1.42%, tests 0.49%. Most TypeScript clones are frozen migration snapshots, which are intentional.
- **Semantic duplication is the real cost.** The same concept is implemented with different code, so jscpd does not see it. Copies have already drifted: crash reports that drop `cause`, search boxes that treat `foo bar` differently per page, three relative-time formats, a credential file written without fsync.

The cost is not the line count (about 3–4k removable). Every new feature that needs a lock, a cache, a temp dir or a relative time writes one more copy, and every copy is a place where behavior can diverge.

## Goals

- One implementation per mechanism, with tests, in the package that owns it.
- Remove code kept alive only for a situation that no longer happens (missing native addon, legacy read paths).
- Make bypasses visible: when a helper exists, newer code uses it.
- Fix the behavior drift the copies already caused.

## Non-goals

- Merging domain code that only looks alike. Desktop/mobile layout pairs, settings list pages, the two sandbox modes, retry loops tied to status events and per-OS process code differ on purpose.
- Touching frozen migration snapshots (`workbench-server/src/infrastructure/migrations/steps/*`). They are copies by design.
- New abstraction layers on top of contracts or protocol. Helpers stay small and concrete.
- DB schema changes. None are needed.

## Phases

| Phase | Outcome                                                        | Touches                                                  | Risk       |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------- | ---------- |
| 1     | Single source of truth: dead code, enums, cross-package copies | all packages, small edits                                | Low        |
| 2     | Shared primitives: async, file, process, formatting, settings  | new foundation package, server, core, tools, app, ui-kit | Low–medium |
| 3     | Shared test support                                            | new private `test-kit`, test files                       | Low        |
| 4     | Retire parallel paths (needs decisions D1–D4)                  | native, server filesystem, tools grep/find, protocol     | Medium     |

Each phase ships on its own and in package-sized PRs. Phases 1 and 3 can run in parallel. Line counts below are audit estimates.

## Phase 1: single source of truth

Mechanical changes with no intended behavior change except where noted as a fix.

### 1.1 Dead code

- Legacy file-completion machinery in `workbench-server/src/domains/filesystem/file-completion-candidates.ts` (`discoverCandidates`, `legacyCandidatesFromEntries`, `directDirectoryCompletionItems`, `sortCandidates`, `FileCompletionCandidate`) has no callers in `src`, only its test. Confirm with `pnpm knip`, delete with the test. ~150 lines.

### 1.2 Contracts enums

- Add `contracts/src/domains/core/scope.ts` with `layerSchema` (`user|project`), `sourceSchema` (`builtin|user|project`), `conversationScopeSchema` (`user|project|conversation`) and their types. Replace ~11 inline `z.enum` copies in contracts and ~20 hand-written unions in consumers (app `SettingLayer`, `SettingsLayer`, `OverrideScope`, `ExtensionsScope`, `InstalledGroup`, `SkillScope`, `ProfileOrigin`; tools `ConfigurationAgentScope`, `agent-port.ts`, `mcp-port.ts`).
- Use existing enums where they are bypassed: `launchDefinitionRunPolicySchema` (re-inlined in `launches/launch.ts`, `pinned-command.ts`, server `launch-definition-migrations.ts`), `bridgeThemeKindSchema` (`theme-file.ts`, `installed-manifest.ts`), `mcpTransportSchema`, the signal enum (`launch.ts`, `operations.ts`). Merge identical `gitStashAreaSchema`/`gitDiffAreaSchema`.
- Tools quick-script ports derive their types from contracts. The model-facing `.d.ts` strings stay, guarded by one test that their enums match the schema options.
- Rename the near-collision `ATTACHMENT_MAX_BYTES` (contracts, 20 MiB) vs `MAX_ATTACHMENT_BYTES` (tools, 100 MiB) so the names say what each limits.

JSON-schema output must stay identical; keep `z.enum`.

### 1.3 Cross-package copies

| Copy                                                                                                                                                                                                                                                               | Single home                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Artifact name regex, `assertArtifactName`, `artifactNameOf`, `MEDIA_TYPES`, `mediaTypeFor` in `tools/.../quick-script/runtime/files/artifacts.ts` and `extensions/src/atlassian/shared/files.ts` (`isArtifactName` already lives in `extension-api/src/errors.ts`) | `extension-api/host`                                                                    |
| `closeMatches`, `editDistance` in `extensions/.../atlassian/shared/args.ts` and `tools/.../quick-script/runtime/sdk-args.ts` (identical)                                                                                                                           | `extension-api/host`                                                                    |
| `writeCrashReportSync`, `serializeCrashError`, `safeStringify` in `desktop-shell/src/crash-reports.ts`; `appendJsonLine`, `SAFE_SESSION_ID`, `performanceLogFilename` in `desktop-shell/src/performance/performance-monitor.ts`                                    | `workbench-server` `./diagnostics` export. **Fix:** desktop crash reports gain `cause`. |
| `checksTone` copied as `MobilePullRequestsBody.tone()`                                                                                                                                                                                                             | export from `features/git`                                                              |
| Tone → text-color map (6 copies: `StatusGlyph`, `ConversationActivityIndicator`, `git-change-format.ts`, `GitPullRequestRow`, `callout.svelte`, design-lab fixture)                                                                                                | `ui-kit/display/status.ts`                                                              |
| `scrollEdges()` reimplemented in `TranscriptList.svelte`                                                                                                                                                                                                           | existing `ui-kit/.../scroll-edges.ts`                                                   |
| Ignore-file name lists (`project-listing.ts`: `.gitignore`, `.ignore`, `.git/info/exclude`; harness: `.gitignore`, `.ignore`, `.fdignore`)                                                                                                                         | one decided list, one constant                                                          |

### 1.4 Bypassed helpers

- **Atomic writes.** Route hand-rolled tmp+rename through `storage-bootstrap/file-mutations.ts` `atomicWriteFile`, adding a sync sibling: `completion-usage-store.ts`, `mcp-tool-index.ts`, `daemon-lease-monitor.ts` (sync), and `desktop-shell/.../remote-credential-store.ts`. **Fix:** the credential store gains fsync and a unique temp name. Decide whether `atomicWriteFile` also fsyncs the directory (as `scoped-store/durable-write.ts` does) so there is one durability level.
- **Usage clients.** `anthropic-client.ts`, `codex-client.ts`, `copilot-client.ts` each write the same fetch skeleton (timeout, 429 → `rate-limited` with `parseRetryAfterMs`, error mapping) and cache-file wrappers. Add `fetchUsageApi` and a `cacheName` option to `cached-usage-fetch.ts`. ~90 lines.
- **Scoped-configuration handlers.** `agentProfiles.delete`/`reset` have identical bodies; a local `guarded(target, fn)` replaces the repeated `try/catch → failure`. ~40 lines.
- **UI recipes.** Use `selectRowVariants` in `QuickOpenDialog`, `ConversationHistoryView`, `GitBranchRow`, `ComposerCompletionPopup`. **Fix:** `ComposerCompletionPopup` uses `bg-muted` for selection, against `workbench-app/AGENTS.md`.

### 1.5 Native (Rust)

- Git status mapping exists twice: `git/repository.rs` `read_status` and `git/project.rs` `apply_item`, plus two `path_text`. Move to one shared `apply_item`; the parity test `lightweight_status_matches_existing_snapshot` guards it. ~55 lines.
- `git/napi.rs` `From<Snapshot>` and `From<MetadataSnapshot>` repeat field-by-field mapping. Add per-item `From` impls (`Reference`, `Remote`, `RecentCommit`, `Stash`). ~65 lines.
- TS wrapper: one `assertBoundedPath` (3 copies in `metadata-client.ts`, `project-client.ts`), one `unwrapNative(result, key)` (~10 copies), one `fail`. ~40 lines.

## Phase 2: shared primitives

### 2.1 Foundation package for runtime primitives

Async and timing helpers are needed by `tools`, `conversation-core`, `workbench-server`, `desktop-shell` and `workbench-app`. No existing package fits: `contracts` is domain schemas, `protocol` is transport mechanics, `extension-api` is the extension contract, `ui-kit` is UI. Proposed: a new dependency-free foundation package (working name `@nervekit/primitives`, see D5), allowed for every package in `package-architecture.rules.ts`.

Contents, each with unit tests:

| Primitive                                                             | Replaces                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KeyedSerialQueue<K>` / `SerialQueue`                                 | ~9 hand-rolled promise chains: `secrets/index.ts`, `tunnel-service.ts`, `logging.ts` `serializeWrite`, `scoped-document-store.ts` `serialize`, `permission-overlays.ts` `writes`, `launch.service.ts` `serializeLaunch`, `extension-store.ts` `withFileMutation`, conversation-core tool-call settlement/workers |
| `singleFlight(map, key, fn)`                                          | ~12 `Map<key, Promise>` dedupe maps in conversation-core (`core.ts` `creations`, `background-task.service.ts`, `compaction-operations.ts`), server (`extension-catalog.ts`, `oauth2-provider.ts`), tools extension-host (`code-adapter.ts`, `runtime.ts`, `availability.ts`, `extension-runtime.ts`)             |
| `sleep(ms, signal?)`                                                  | 4 server copies                                                                                                                                                                                                                                                                                                  |
| `createDebouncedTask(fn, ms, clock?)` → `{ schedule, flush, cancel }` | ~7 `setTimeout`/`clearTimeout` pairs in the app (`settings-actions`, `configuration-attention-state`, `attention-delivery`, `ActivityPopover`, `oauth-flow-session`, `client-logger`)                                                                                                                            |

The queue's error policy is an explicit option, because today some sites swallow the previous failure (`.catch(() => undefined)`) and others run after it (`then(op, op)`). Migrate the ordering-sensitive stores (scoped-document-store, permission overlays, secrets) last, each with an ordering and error-recovery test.

### 2.2 Server and tools

- `readJsonFile(path, schema, { missing })` in server infrastructure for ~8 read → parse → validate sites in permissions, configuration review and extension store. User-facing error messages stay per site.
- One `runManagedProcess` in `tools/src/execution/` for the shared lifecycle of `bash.ts` and `python.ts` (spawn, timeout kill, `timeoutMessage`, truncated-output footer). The python sandbox policy stays in `python.ts`. ~100 lines.
- One `formatBytes` in `tools/src/execution/output` for 5 copies with different units (`KB`/` KB`, `MiB`/`MB`).

### 2.3 App and ui-kit

- `KeyedLoader<K, V>` in `workbench-app/src/lib/application/` (`ensure`, `refresh`, `invalidate`, generation guard, error hook) for `agent-profile-catalog`, `permission-rule-set-catalog`, `project-agent-defaults` and `maintenance-controller`. Each keeps its error policy through the hook. Built on `singleFlight`.
- `LayeredAgentState` next to `scoped-agent-state.svelte.ts` for the user+project pair and its four effects, repeated in `SkillsSettingsPage`, `ToolsSettingsPage`, `GeneralSettingsPage`, `profiles-store`, `mcp-enablement-state`; plus `isProjectLocked(document)` for 7 copies of the trust check.
- In `ui-kit/display/time.ts`: `formatElapsedClock` (5 identical `m:ss` copies) and one relative-time function with compact and long styles (5 variants with different thresholds). **Fix:** one rounding rule everywhere.
- `matchesTerms(query, ...fields)` in `ui-kit/collections/` based on `filterCommandItems`, used by ~10 list filters. **Fix:** every search box splits on whitespace the same way.
- Rebuild `PlanImplementationModelDialog` on `ModelPickerPanel` and `ToggleGroup`; drops a fourth `thinkingLevelLabel` and a forbidden selection border. ~90 lines.

## Phase 3: shared test support

Test code is ~145k lines next to ~285k source lines. Literal duplication is low, but there is almost no shared support, so helpers are rewritten per file.

- New private workspace package `packages/test-kit` (`"private": true`, no `@nervekit/*` dependencies, used only as a devDependency from test files):
  - `makeTempDir(t, prefix)` registering cleanup with `t.after` and a retrying `rm`. Replaces temp-dir lifecycle code in ~175 files written in four styles, some without retry. ~600–1,000 lines.
  - `waitFor`, `flush`, `waitForProcessExit`: `native/test/support/wait-for.ts` and `tools/test/support/wait-for.ts` are byte-identical, the server one adds `flushMicrotasks`, plus ~5 local variants and ~30 local `tick`/`settle`/`flush`.
  - `createManualTimerCore()`: one ordered-timer core for ~7 fake clocks (protocol `fake-clock.ts` plus two local ones, app `polling/fake-clock.ts`, ui-kit scheduler test, `background-jobs.service.test.ts`, desktop `FakeScheduler`). Port-shaped adapters stay with their owners.
  - `stubFetch(t, handler)` and `jsonResponse()` for 41 manual `globalThis.fetch` swaps that restore by hand.
- Keep test support out of production builds: move `workbench-server/src/domains/accounts/test-support.ts`, `extensions/src/atlassian/test-support.ts` and `migrations/framework/testing/corruption-suite.ts` out of `src/` or exclude them from `dist/`. The published `extension-api` and `extension-sdk` `testing` subpaths stay.
- Replace relative imports into `contracts/src` from `ui-kit/src/styles/theme-contrast.test.ts` and `website/scripts/screenshots/demo-github.test.ts`.
- Migrate a package at a time. New tests use test-kit from the start.

## Phase 4: retire parallel paths

These remove the most code but change behavior or support policy. Each starts only after its decision.

- **Native `files` required (D1).** `workbench-server/src/domains/filesystem/native-files.ts` re-declares native's types "for when the addon predates the API" and keeps three Node fallbacks: `file-completion-candidates.ts` (`git ls-files` + `fdir` walk with a hardcoded skip list), `project-path-index.ts` `fuzzyScorePath`, `project-listing.ts` `readdir` fallback (which cannot report gitignored entries). Content search already has no fallback (501). Import types from `@nervekit/native`, add `files` to the required capabilities, delete the fallbacks and possibly the `fdir` dependency. ~450 lines.
- **Legacy git read path (D2).** Rust `ReadContext::legacy()` and `NativeGitError`, TS `NativeGitReadError` (still used by `tools/src/git/read/observed-backend.ts`), next to the bounded, cancellable project path with `ErrorDetail`/`NativeOperationError`. Move `readGitRepositoryInfo`, `readGitSnapshot` and ancestry to the bounded path; one error taxonomy remains. ~100 lines.
- **Agent grep/find on native (D3).** `tools/src/execution/filesystem/search.ts` spawns `rg`, `find.ts` spawns `fd`, both with a Node walk fallback (`search-utils.ts`), next to native `files.searchContent`. Three engines and the `GrepBackendMode` matrix become one. Needs a parity check on context lines, output budgets, glob and ignore semantics first. ~500 lines.
- **Protocol idempotency (D4).** `protocol/src/rpc/idempotency-store.ts` has no production caller, while contracts declare `idempotency: required`. Wire it into the RPC server or delete it and the policy field.

## Decisions

| #   | Question                                                                       | Recommendation                                                                                                              |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| D1  | Is the native addon required for file listing, `@` completion and path search? | Yes, if prebuilds cover every shipped platform (verify Windows/ARM first). Content search already requires it.              |
| D2  | Retire the legacy unbounded git read path?                                     | Yes. Bounded reads are the current design; legacy callers get limits they should have had.                                  |
| D3  | Move agent grep/find from `rg`/`fd` to native search?                          | Scope after a parity spike; do not block other phases on it.                                                                |
| D4  | Wire or delete protocol idempotency?                                           | Trace whether any `required` method relies on it. If none, delete.                                                          |
| D5  | New foundation package for runtime primitives, and its name?                   | Yes, dependency-free, allowed everywhere. Alternatives (duplicating per layer, stretching `protocol`) recreate the problem. |
| D6  | One durability level for atomic writes (fsync the directory or not)?           | Fsync the directory for configuration and credentials; keep the cheaper write for caches and indexes, by name.              |

## Keeping it consolidated

- Document the primitives package and test-kit in `docs/architecture/codebase.md` and point to them from `AGENTS.md`, so agents reach for them before writing a timer, queue or temp dir.
- Add jscpd to CI as a ratchet (fail on new clones above the current baseline, migrations excluded) for TypeScript and Rust.
- Consider lint rules where cheap: no `mkdtemp` in tests outside test-kit, no raw `setTimeout` sleep in tests, no `writeFile` + `rename` outside `file-mutations.ts`.
- Re-run the audit after each phase and record the numbers here.

## Expected result

| Phase | Lines removed (estimate) | Behavior fixes                                                                              |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------- |
| 1     | ~600                     | crash-report `cause`, credential fsync, selection styling, one source for scope enums       |
| 2     | ~700                     | consistent search, relative times and byte units; tested queue/single-flight semantics      |
| 3     | ~1,000–1,500             | temp-dir cleanup with retry everywhere, fetch stubs always restored, no test code in `dist` |
| 4     | ~1,000                   | one search engine, one git error taxonomy, gitignore-aware listing everywhere               |

## Outcome

Measured after implementation: 497 files changed, net about −670 lines. jscpd source clones went from 90 to 74 (0.49% to 0.42%). Line savings came in well below the estimates. The new packages, their tests and native agent search add code. Many sites turned out to have different semantics and stayed as they are.

Decisions taken: D1 yes (all six shipped native targets include `files`). D2 yes. D3 yes, with native `files.grep`/`files.findFiles`. D4: removed idempotency completely, including the `idempotencyKey` envelope field. The request schema ignores unknown fields, so old clients keep working. D5 `@nervekit/primitives` and `@nervekit/test-kit`. D6 per-call `durability: none | file | directory`.

Deliberately not changed (semantics differ from the shared helper):

- Extension-host session and code caches, `extension-catalog` scans and the OAuth discovery map keep settled results, while `singleFlight` drops them.
- `core.ts` `creations` chains after the first create, and `background-task.service.ts` watchers.
- `maintenance-controller`, and the debounce sites with fixed windows or effect-scoped timers (`attention-delivery`, `client-logger`, `oauth-flow-session`, `ActivityPopover`).
- `scoped-document-store` and `extension-store` already use the shared `withFileMutation`.
- The `executable.ts` tree kill (cross-spawn child, not a native managed process).
- Test support in `dist/`: tests compile into `dist` in every package. `workbench-server` excludes tests and its support files via `files`; a repo-wide policy is open.
- The `background-jobs` fake clock (needs a wall-clock jump), and temp dirs in fixture helpers without a test context.

User-visible changes:

- Grep and find results come back in path order, and `.rgignore`/`.fdignore` are no longer read.
- `node_modules` is skipped only when ignored, in file listing, completion and agent search.
- The git snapshot status limit is 20,000 entries.
- Relative times round down everywhere: "now" lasts up to 60 s, and PR rows show weeks.
- Every list search splits on whitespace.
- Byte sizes are written as `50.0 KB`.
- Desktop crash reports include `cause`.
- Pending RPC requests are rejected on a transport drop instead of being retried.

## Leave alone

Frozen migration snapshots, desktop/mobile layout pairs, settings list pages, the two sandbox modes (`sandbox/mod.rs`, `persistent.rs`), per-OS process code, retry loops, napi `Task` boilerplate (a macro would cost readability), path helpers (add UNC tests first), hashing wrappers, domain-specific test builders.
