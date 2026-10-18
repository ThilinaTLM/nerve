# Synthetic project Git refresh

## Scope and reproduction

Run from `packages/native`, with a coordinated current **release** addon build:

```sh
for n in 1 5 20; do
  for mode in repeated shared native-individual native-shared native; do
    pnpm exec tsx test/benchmarks/git-refresh.benchmark.ts "$n" "$mode"
  done
done
```

Each case is an isolated process with synthetic temporary repositories only. Fixture CLI invocations and native reads use an empty global/system configuration; CLI hooks/templates, signing, attributes and credentials are isolated/disabled. No network or real remote repositories are used. Fixtures contain 200 tracked files, 100 additional branch refs, 10 modified files (one staged), 10 ignored files and one untracked file per repository. Setup/cleanup are outside timing. Filesystem caches are not flushed.

Modes:

- `repeated`: existing native full snapshots, four TS workers, separate listing/status discovery and snapshot passes.
- `shared`: same full individual reads, but reuse one discovery list.
- `native-individual`: shared native discovery, lightweight native reads one repository per call, two TS workers.
- `native-shared`: one lightweight batch over shared native discovery.
- `native`: new native discovery plus one lightweight batch on every refresh.

The measured unit is the whole **synthetic refresh orchestration call**, including async/native dispatch, N-API conversion and branch/file response assembly. It is not the production `GitService` route: authorization, project/cache lookup, lanes, transport and monitor invalidation remain owned outside native. Both old/new variants return the same normalized synthetic branch/file output. Count assertions and a deterministic digest detect missing/changed file status output; Rust unit fixtures separately cover staged rename, upstream, linked worktrees and progress state.

After one initial refresh, report nine warm rounds (p50/p95, with p95 the maximum of nine), first-refresh time after fixture/cache preparation, Node event-loop delay (1 ms resolution), sampled peak RSS (2 ms interval), retained RSS and response bytes. RSS includes addon, Node, fixture setup and allocator retention; it is not native-only memory. Tiny warm samples and shared-machine scheduling are noisy. No cold-cache, real-project or cross-platform claims are made.

## Results

The exploratory pre-change baseline below is retained separately. The complete frozen-addon comparison follows it and isolates lightweight-read savings from batching alone. These are synthetic orchestration measurements, not production-route or cross-platform evidence.

Linux x64 / Node 24.21.0 isolated baseline (nine warm rounds; shared-machine noise, not cross-platform evidence):

| Repos | Mode     | p50 / p95 ms  | Event-loop p95 / max ms | Peak / retained RSS MiB |
| ----- | -------- | ------------- | ----------------------- | ----------------------- |
| 1     | repeated | 5.09 / 6.77   | 1.46 / 1.71             | 110.25 / 109.45         |
| 1     | shared   | 4.13 / 4.88   | 1.40 / 1.48             | 88.95 / 88.95           |
| 5     | repeated | 11.65 / 15.20 | 1.57 / 2.13             | 98.15 / 97.07           |
| 5     | shared   | 9.25 / 10.66  | 1.56 / 1.93             | 97.38 / 95.57           |
| 20    | repeated | 31.32 / 32.88 | 1.65 / 2.04             | 103.60 / 100.46         |
| 20    | shared   | 31.51 / 33.00 | 1.63 / 1.99             | 103.68 / 102.74         |

Per-size normalized file digests matched between baseline modes. Raw local output: `/tmp/nerve-git-baseline-final.jsonl`. The inconsistent RSS and lack of a 20-repository cache-only latency win reinforce that these small synthetic runs do not establish universal savings.

## Frozen combined-addon comparison (Linux x64)

All 15 cases ran serially after the preceding heavy benchmark owner released the window, using one unchanged release addon. Node **24.21.0**, Linux **x64**. Each case is its own process; nine warm rounds follow one initial refresh. Baseline-mode reruns below use the same frozen addon as the lightweight modes (including the approved additive detailed `inProgress` field). The exploratory earlier baseline is not mixed into the speedup calculations.

| Repos | Mode              | Initial refresh ms | Warm p50 / p95 ms | Event-loop p95 / max ms | Sampled peak / retained RSS MiB |
| ----- | ----------------- | ------------------ | ----------------- | ----------------------- | ------------------------------- |
| 1     | repeated          | 10.90              | 4.19 / 5.50       | 1.52 / 1.90             | 106.96 / 106.91                 |
| 1     | shared            | 10.15              | 3.97 / 4.78       | 1.80 / 1.89             | 90.84 / 90.84                   |
| 1     | native-individual | 7.59               | 2.53 / 2.79       | 1.56 / 1.81             | 80.09 / 80.09                   |
| 1     | native-shared     | 7.37               | 2.53 / 2.79       | 1.65 / 1.76             | 81.80 / 81.99                   |
| 1     | native            | 7.49               | 2.76 / 2.95       | 1.70 / 1.71             | 82.39 / 82.39                   |
| 5     | repeated          | 15.31              | 9.64 / 10.22      | 1.55 / 1.77             | 101.55 / 98.68                  |
| 5     | shared            | 17.16              | 9.14 / 9.88       | 1.77 / 2.00             | 100.25 / 96.31                  |
| 5     | native-individual | 12.64              | 8.00 / 8.34       | 1.81 / 1.91             | 84.56 / 84.55                   |
| 5     | native-shared     | 12.06              | 6.18 / 7.42       | 1.28 / 1.69             | 86.28 / 86.28                   |
| 5     | native            | 13.24              | 6.93 / 8.21       | 1.46 / 1.86             | 86.30 / 85.93                   |
| 20    | repeated          | 37.40              | 31.00 / 33.43     | 1.83 / 2.05             | 103.85 / 102.50                 |
| 20    | shared            | 36.09              | 29.97 / 30.85     | 1.70 / 1.97             | 102.62 / 101.65                 |
| 20    | native-individual | 32.29              | 26.35 / 27.41     | 1.75 / 1.98             | 88.35 / 88.32                   |
| 20    | native-shared     | 29.21              | 23.13 / 24.59     | 1.18 / 1.62             | 88.82 / 88.63                   |
| 20    | native            | 29.31              | 24.59 / 26.11     | 1.23 / 1.64             | 88.71 / 88.46                   |

### Verdict: lightweight reads versus batching alone

- **Lightweight individual reads versus cached full individual reads:** warm p50 reductions **36.2% / 12.4% / 12.1%** at 1/5/20 repositories. This removes the unnecessary second full snapshot and refs/remotes/history/stash transfer; it is not a batching-only win. Full reads used four TS workers, lightweight individual reads used two bounded workers, so this is a whole-path/policy comparison rather than a same-concurrency kernel microbenchmark.
- **Batching alone versus lightweight individual reads**, both using shared native discovery and two repository workers: effectively **no 1-repository improvement**; warm p50 reductions **22.8% at 5** and **12.2% at 20**. Corresponding p95 reductions were **11.0% / 10.3%**. This is positive whole-call evidence for adopting the bounded multi-repository batch on this measured workload; it does not establish gains on all repository shapes or platforms.
- **Discovery-plus-batch replacement versus repeated-discovery/full-read path:** p50 **4.19 → 2.76 ms**, **9.64 → 6.93 ms**, **31.00 → 24.59 ms** at 1/5/20 (34.2% / 28.1% / 20.7% lower). These are synthetic whole-orchestration calls, not production routes.
- **Cached batch versus repeated-discovery/full-read path:** p50 **4.19 → 2.53 ms**, **9.64 → 6.18 ms**, **31.00 → 23.13 ms** (1/5/20). New discovery on every refresh instead of reusing its result costs **2.76 / 6.93 / 24.59 ms** total; cache reuse remains meaningful.
- **Memory:** cached batch retained RSS was **81.99 / 86.28 / 88.63 MiB**, versus repeated/full **106.91 / 98.68 / 102.50 MiB** in these processes. Batching alone did **not** reduce RSS versus lightweight individual reads (**80.09 / 84.55 / 88.32 MiB**). Setup, module loading, allocator retention and scheduling contribute; no universal native-memory saving or hard RSS bound is claimed. A sampled peak can be below final retained RSS because of the 2 ms sampling interval and final allocations.
- **Event loop:** all cases had maximum measured delay below **2.1 ms**. The full-reader baseline was already asynchronous; sub-millisecond differences at 1 ms timer resolution are not evidence of a material responsiveness improvement.
- **Parity:** all five modes matched the same per-size normalized file-status digest and output size: **2,257 / 11,201 / 45,171 bytes** at 1/5/20. These fixtures have no configured external filters or divergent upstreams; separate owning fixtures cover upstream/ahead-behind, rename, submodule and operation-state correctness.

### Frozen artifacts and validation

Preserved directory: `/tmp/nerve-git-frozen-828af0d5/`.

- Addon before and after tests/measurements: `828af0d5d593425565bf60c18bce0e1b96009eb2a3d09b3a51a8a07e50f5c992`.
- Raw 15-case output: `nerve-git-refresh-after.jsonl`, SHA-256 `0f70c633682a8f5fd78468653619924958acf089f1b1a471897e4cfb20405224`.
- Preserved addon binary, source/declaration archive, raw baseline and unit logs, and `artifact-sha256.txt` accompany the results. These remain evidence for this binary before the next machine-diagnostic correction; no benchmark or binary changes occurred mid-run.
- Native package exact-file units: **16 passed** (`project-native.test.ts`, `git-read.test.ts`, `project-client.test.ts`). This includes actual canonical/status parity, unused global filters, per-repository overflow, cancellation/admission retention and staged/dirty gitlinks.
- Actual managed-helper units: **3 passed on Linux x64** (`packages/tools/test/git/read/git-isolated-reader-native.test.ts`): dev source bootstrap/state parity, selected native clean-filter parity, and cancellation of a TERM-ignoring filter with helper closure/descendant exit verified before rejection. POSIX filter fixtures are skipped on Windows; Windows/macOS executions are not claimed.
- Helper protocol/mock lifecycle units: **10 passed**, covering global two-active/16-waiting admission, queue abort/deadline, close-await, bounded/sanitized IPC, overflow and loader selection.
- Scoped helper strict typecheck and prior native package typecheck/Rust owning units passed. No repository-wide checks, integration files, commits or independent addon rebuild were run in this window.

## Native read contract and limits

New reads are ephemeral; no persistence or Git CLI mutation behavior changes. Existing detailed snapshots gained the approved additive `inProgress` field, reusing the same native operation-state function; existing signatures/other fields and shared wire contracts are preserved.

- At most two admitted operation handles, reserved **before** AsyncTask dispatch; no native waiting queue. Saturation is `limit_exceeded`, explicitly retryable.
- At most two repository workers per call, four globally across these new calls. Each synchronous low-level gix worktree-status invocation starts up to two joined producer threads; tracked status is configured with `thread_limit = 1` (the pinned gix-features helper selects its serial path). Index decoding separately honors `index.threads`, so the new path overrides that key to 1 in the repository's **in-memory** config view only. This accounts for up to two libuv dispatchers, four repository workers and eight status producers across these calls, rather than assuming four total OS threads. Builtin nested status iterators are never invoked. Submodule checkout/index/HEAD metadata uses gix’s metadata-only ignore-dirty mode; dirty contents use the same joined low-level reader, sequentially before parent status producers start. An immutable precomputed submodule port preserves staged/dirty gitlink status without multiplying active threads. Existing legacy Git/monitor/search/process budgets are unchanged.
- 128 repositories/call; at most 128 subordinate submodule reads/call and eight nested submodule levels; 4,096 UTF-8 bytes/path; discovery examines at most 100,000 entries; 100,000 index entries/repository; 20,000 returned status paths/repository; aggregate 8 MiB conservative path/record accounting. Limit failures return errors, never successful truncated file lists or counts. Revision walks cap emitted commits at 100,000 per direction.
- These are input/result/admission bounds, **not a hard process-RSS bound**: gix materializes trees/indexes, uses internal channels, and hidden-history traversal can do work before emitting a commit. Tree expansion, object decoding and filesystem operations have noninterruptible sections.
- Cancellation handles share the extracted core token. Discovery/status/commit loops check cancellation; low-level gix status receives its atomic flag and joins producer work before return. JS does not reject early while native work continues. Closing removes lookup immediately, but in-flight ownership retains the permit until work finishes.
- Unused global/local filter definitions are supported, including unused LFS-style configuration. gix resolves tracked-file attributes before/after status; if they select an external clean/process driver, the measured pre-diagnostic binary returns `unsupported` rather than fabricated status; the current source now returns the stable `isolation_required` category (`retryable: false`). Driver definitions are removed only from the temporary in-memory read config so an attributes race cannot launch an unbounded program; on-disk configuration and built-in text/EOL/encoding behavior are unchanged. Active external filters are handled by the approved managed-helper adapter below, using the same existing detailed native reader. Gitlinks, uninitialized submodules, dirty contents, untracked-ignore modes, changed HEADs and staged updates use the same bounded native reader, not a fallback reader.
- Discovery preserves root-repository short-circuiting, hidden/build/vendor exclusions, no following directory symlinks, and existing depth semantics (repositories three path components below root can be detected). Canonical containment checks reject worktree escapes. Root and child bound/cancellation/safety failures propagate instead of being downgraded to not-a-repository; inherited unreadable-directory/corrupt-repository skipping remains, so discovery does not claim completeness for inaccessible trees. Valid linked-worktree/submodule metadata may live outside the project; discovery does not recursively walk that metadata.
- New status reads never call `Outcome::write_changes()` or a Git write API. gix's pinned iterator source documents explicit index writeback; its high-level cancellation path can return before producer completion, hence the low-level joined implementation here. A complete proof that every subordinate read is nonlocking is **not claimed**: tools must retain canonical `gitDir` lane and `commonDir` gate coordination through native completion.

## Managed isolation for selected external filters

Pinned gix constructs its concrete filter pipeline inside `Repository::index_worktree_status()`. Its clean and long-running process drivers spawn programs and perform synchronous reads/writes without an injected cancellation token or joined managed-process lifecycle. Passing a cancellation atomic to status does not interrupt blocked filter I/O. In-process lightweight reads therefore request isolation rather than silently disabling an active filter; unused definitions are supported normally.

The approved implementation is `packages/tools/src/git/read/git-isolated-reader*.ts`, with `createGitIsolatedReader().read(repository, { includeIgnored?, signal?, timeoutMs? })` returning `NativeGitProjectSnapshot` and `close(): Promise<void>`. C owns authorized adoption and repository coordination/shutdown wiring. It uses the same existing `readGitSnapshot` kernel in an ephemeral managed Node process, normalizing only the bounded representation. `inProgress` comes from the detailed native snapshot; no marker-policy duplication, CLI read fallback, second Git kernel or extra Rust binary is introduced.

Production resolves the compiled packaged sibling `.js`; development forwards established TS loader flags to a sibling `.ts`. Current actual tests exercise the dev bootstrap; compiled-path selection and strict typechecking passed, but a separate packaged-dist execution was not run. Input is bounded JSON in one argument (the managed host has no stdin API), not a shell command. The unchanged 8 KiB cap now includes C’s expected canonical `workDir`, `gitDir` and `commonDir`; oversized descriptors fail explicitly with `limit_exceeded` before helper admission/spawn. One newline-terminated frame is capped at 8 MiB, stderr at 64 KiB; raw stdout/stderr/filter errors never become application error messages.

The helper compares freshly discovered identity with the C-authorized/gated expected identity **before** calling the detailed reader or executing filters, and retains post-read identity checks. C’s shared `gitPathKey` supplies all pre/post/parent comparisons, including Windows prefix/case spellings; comparison keys never replace actual I/O paths. External filesystem changes can still race these checks: no transactional snapshot or immunity to concurrent external replacement is claimed. Pure Linux-run fixtures cover stale identity (zero detailed-reader calls), post-read replacement, and Windows drive/UNC Node-versus-Rust spellings. The actual moved-directory/filter-marker fixture awaits the next rebuilt-addon test window.

Admission is globally **two active + 16 waiting** across reader instances. Queue cancellation/deadline removes pending work promptly. The helper retains a keepalive/SIGTERM handler after response generation so the leader remains present through parent TERM→KILL cleanup; the parent drains and awaits `closed`/output stats before releasing admission or settling success/failure. `close()` aborts and awaits all owned work. No persistent pool or state is added.

The helper’s existing detailed gix reader can create its own internal threads; two helpers does not mean two OS workers. Each helper requests **1 GiB memory, two CPU cores, 32 processes**, a 256 MiB Node old-space limit, one libuv worker/one V8 pool worker, and guarded wall/output limits. Hard resource enforcement depends on native host/platform configuration; Windows process limits do not constitute a thread-count cap, and POSIX process groups are not a security sandbox against descendants escaping their group. Linux unit evidence verifies process-group cleanup, not universal hard-limit enforcement or hostile escape containment. Production Git configuration is not rewritten.

**Diagnostic correction status (after preserved measurements):** shared native/core category `isolation_required` now classifies only attribute-selected external-filter cases; other error categories/signatures are unchanged. C must switch dispatch to the category and remove its existing human-message comparison; that C-owned integration is not claimed complete here. The owning Rust filter fixture verifies the serialized category and conservative retryability; native typecheck, nine façade units, 14 Git Rust units and one core-error unit passed before native sources were frozen for the sole coordinated builder. Helper category/identity protocol and lifecycle/work units now total 16 passing cases; scoped strict helper typecheck passed. Actual rebuilt-addon assertions are prepared but must run only after the next addon-ready handoff. The `/tmp/nerve-git-frozen-828af0d5/` binary, source archive, raw logs and artifact manifest remain the immutable **before-correction** checkpoint; no heavy benchmark was rerun or relabeled as a different binary.

## Metadata/monitor source follow-up (not measured above)

The next released source window adds `readGitMetadataSnapshot(path, { refLimit?, recentCommitLimit?, stashLimit?, signal? }) -> Promise<Omit<NativeGitSnapshot, "files">>`. Defaults are 100,000 refs, zero history and zero stashes. Zero history/stash requests skip those helpers entirely; a zero ref limit still fails on any reference. The legacy detailed reader and its zero `statusLimit` failure semantics are unchanged. The new reader shares the existing head/ref/remote/history/stash kernels, retains symbolic targets/upstreams/timestamps and operation state, and never enters status/index/worktree/filter traversal.

Metadata has real native operation handles, shared two-call admission and cooperative cancellation between records/revision steps. It fails explicitly at a 16 MiB **result-accounting** budget (UTF-8 text plus fixed per-record charges), or one million aggregate delivered revision steps across ahead/behind/history. Neither budget is a hard RSS or wall-time guarantee. gix open/config parsing, filesystem calls, object materialization/decoding, sorting and individual iterator advancement remain noninterruptible sections. A single such operation may allocate before the next accounting/cancellation check. Native admission is retained through task completion, not released by a Promise-only abort.

The monitor now composes the same metadata helpers (existing detailed defaults: 10 recent commits, 1,000 stashes, 100,000 refs) with the existing joined, guarded status reader and returns the **same full Snapshot schema** for hashing. Owning fixtures check exact legacy hash parity and worktree/ref/remote/stash-reflog-only invalidation; selected filters never execute in the parent. Existing guarded-status limits apply, including 20,000 statuses, 100,000 index entries and 8 MiB status accounting: exceeding them is an explicit poll error, not omitted data or empty success. This is stricter than the legacy detailed reader's 100,000-status default.

Repeated pure `poll_error` notices must not abort a slow isolated read every polling interval. B/C-owned source ports classify pure poll errors and directory periodic polls as `uncertain_poll`, preserving hard invalidation for proven Git fingerprint changes, real filesystem/manual/overflow/mixed causes, explicit supersession and shutdown. The cache must mark active data stale, coalesce one demand-owned follow-up, and not create an idle retry loop. Those concurrent cache/event/UI ports and their 35-second fake-clock slow-helper validation are **not validated by these native tests**. Native monitor safety alone is not an end-to-end starvation fix.

The file-diff audit found only raw revision/index blobs or canonical-contained filesystem reads, not filter/textconv execution. Worktree reads are noninterruptible and the 16 MiB document bound is checked after materialization; this is not a hard allocation bound.

The metadata/current-category/identity-fix actual-addon tests await the sole builder's rebuilt-addon handoff. No independent addon build or heavy timings ran in this source window; the frozen tables/artifacts above are unchanged. Combined-addon acceptance also remains provisional: the root-owner's separate optimized64 search burst p50 overhead versus A8 is still **5.4% (100k) / 8.8% (20k)**, despite warm main-Node heartbeat near 1 ms and cold/RSS wins. The earlier large regression was fixed, but the no-regression goal is **not** met; whole-service D measurements decide final acceptance. The root search checkpoint `/tmp/nerve-search-checkpoint-53292194.tar.gz` remains preserved.
