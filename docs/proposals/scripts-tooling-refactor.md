# Scripts tooling refactor

Status: proposal. Docs only; no code changes accompany this document.

`scripts/` holds ~12k lines of repository tooling (a large share of it tests). The directory layout is sound (`scripts/README.md` assigns one responsibility per directory), but the _inside_ is uneven: three independent "what changed, what is affected" engines, five CLI conventions, untyped `.mjs` next to `.ts`, and policy encoded as bespoke functions. This proposal keeps `pnpm fix:focused`, `pnpm check:focused`, `pnpm test:focused` and every CI step behaviourally identical while consolidating the internals in small mergeable steps. CI lead time and job structure are owned by [testing-improvements.md](./testing-improvements.md) section 0; this document owns the tooling code behind them (the `ci-impact.mjs` engine, ownership rules data, change inventory) and local speed. See [Speed](#speed) for the exact split.

## Inventory

Lines exclude tests. "Callers" are `package.json` scripts (root unless noted), `.github/workflows/*`, or other scripts.

| Script                                                                                                                                        | Purpose                                                                       | Entry                                      |  Lines | Lang       | Tests                        | Callers                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ | -----: | ---------- | ---------------------------- | ----------------------------------------------- |
| `checks/focused-validation-selection.mjs`                                                                                                     | Plans fix/check stages (format, lint, policies, migrations, packages, native) | module                                     |    559 | mjs        | yes                          | `run-focused-fix/checks` via runner             |
| `checks/focused-validation-runner.mjs`                                                                                                        | Parses `--base/--dry-run`, prints plan, executes stages                       | module                                     |    197 | mjs        | yes                          | `run-focused-fix.mjs`, `run-focused-checks.mjs` |
| `checks/run-focused-fix.mjs`, `run-focused-checks.mjs`                                                                                        | 7-line shims calling `main("fix"\|"check")`                                   | `fix:focused`, `check:focused`             |     14 | mjs        | no                           | root `package.json`                             |
| `checks/validation-impact.mjs`                                                                                                                | Classifies paths (prose/config/runtime/etc.) into stage impact                | module                                     |    213 | mjs        | yes                          | selection                                       |
| `checks/check-package-boundaries.mjs`                                                                                                         | Runs all policy checks over one source inventory                              | `check`, CI "Fast baseline"                |     47 | mjs        | indirect                     | root `check`, `ci.yml:75`                       |
| `checks/repository-source-inventory.mjs`                                                                                                      | Git-tracked file inventory for policy checks (spawns git)                     | module                                     |    137 | mjs        | yes                          | boundary checks                                 |
| `checks/package-boundary-checks.mjs`                                                                                                          | Package dependency/import boundaries                                          | module                                     |    216 | mjs        | yes                          | `check-package-boundaries`                      |
| `checks/workbench-boundaries.mjs` + `-checks.mjs`                                                                                             | Workbench-app layering rules (rules data + checker)                           | module                                     |    286 | mjs        | yes                          | `check-package-boundaries`                      |
| `checks/ui-style-checks.mjs`, `style-policy.mjs`                                                                                              | UI token/class policy; `style-policy` owns the global-class allowlist         | module                                     |    588 | mjs        | style-policy only            | `check-package-boundaries`                      |
| `checks/retired-surface-checks.mjs`                                                                                                           | Forbids references to retired surfaces                                        | module                                     |    147 | mjs        | via repository-boundary test | `check-package-boundaries`                      |
| `checks/package-export-surfaces.mjs`                                                                                                          | Validates `exports` maps                                                      | module                                     |    208 | mjs        | yes                          | `check-package-boundaries`                      |
| `checks/contracts-source-policy`, `server-test-runtime-policy`, `source-naming-policy`                                                        | Three tiny single-rule policies                                               | module                                     |     90 | mjs        | yes                          | `check-package-boundaries`                      |
| `checks/check-built-package-exports.mjs`                                                                                                      | Post-build export smoke                                                       | `build`                                    |     11 | mjs        | no                           | root `build`                                    |
| `testing/ci-impact.mjs`                                                                                                                       | Workspace graph load, path→package ownership, CI output flags                 | `node … --base/--full`, CI `ci.yml:39,44`  |    344 | mjs        | yes                          | CI; imported by focused selections              |
| `testing/focused-test-selection.mjs`                                                                                                          | Plans `test:focused` (import graph + package fallbacks)                       | module                                     |    317 | mjs        | yes                          | `run-focused-tests.mjs`                         |
| `testing/run-focused-tests.mjs`                                                                                                               | CLI parse, describe, execute                                                  | `test:focused`                             |     84 | mjs        | via selection                | root `package.json`                             |
| `testing/test-import-graph.mjs`                                                                                                               | Test→source import graph                                                      | module                                     |    260 | mjs        | via selection                | focused-test-selection                          |
| `testing/run-affected-packages.mjs`                                                                                                           | Runs `pnpm --filter … build\|check\|test` from `NERVE_AFFECTED_PACKAGES`      | CI `ci.yml:85,91,97`                       |     63 | mjs        | yes                          | CI                                              |
| `shared/git-changes.mjs`                                                                                                                      | Base/merge-base, change inventory, `readGitFile`                              | module                                     |     96 | mjs        | yes                          | focused selections                              |
| `shared/workspace-architecture.mjs`                                                                                                           | Hand-written package list + allowed `@nervekit/*` dependencies                | module                                     |     73 | mjs        | no                           | boundary checks                                 |
| `build/generate-brand-assets.mjs`                                                                                                             | Icons/brand assets (sharp, png-to-ico)                                        | `desktop-shell` `icons`                    |    260 | mjs        | no                           | `packages/desktop-shell/package.json:28`        |
| `build/copy-*.mjs` (2)                                                                                                                        | Asset copies                                                                  | `build`, `build:workbench-runtime`, skills |     38 | mjs        | no                           | root + `packages/skills/package.json:27,29`     |
| `development/dev-workbench.mjs`                                                                                                               | `pnpm dev`/`dev:ui` orchestration                                             | `dev`, `dev:ui` (via `tsx`)                |    116 | mjs        | smoke                        | root                                            |
| `development/{owned-processes,slot-preflight,storage-slot}.mjs`, `prepare-slot.ts`, `storage-preparation.ts`                                  | Slot selection, preflight, disposable storage                                 | module                                     |    383 | mixed      | `storage-slot.test.ts`       | dev-workbench, `storage-copy.ts`                |
| `storage-migrations/{run.mjs,check,migrate,rehearse,rehearse-baseline,storage-copy,home-clone,home-operations,validate-history,*-options}.ts` | Migration check/migrate/rehearse/copy                                         | `storage:*`, `migrations:check`            |   800+ | mixed      | yes (mostly `.ts`)           | root                                            |
| `release/*` (15 files, `tag-release.sh`)                                                                                                      | Version, tag, pack, verify tarballs/prebuilds, smoke tests                    | `release.yml`, `ci.yml:122,126`            | ~1,950 | mjs + 1 sh | version + prebuilds only     | workflows                                       |

Package-local script trees (`packages/{contracts,desktop-shell,native,website,workbench-app,workbench-server}/scripts/`) are out of scope except where they share helpers (see Problem 6). Counts are from `wc -l` on 2026-11-05.

## Problems

### 1. Three overlapping "what is affected" engines

- `testing/ci-impact.mjs:66` `loadWorkspace` (package manifests → dependency graph) plus `reverseDependencyClosure`, `packageForPath`, `isGlobalPath`, `isIgnoredPath` (`:220-:272`). It is both CI classifier _and_ library; `checks/focused-validation-selection.mjs:16` and `testing/focused-test-selection.mjs:11` import it (a `checks/` module importing from `testing/`, which `scripts/README.md` ownership does not describe).
- `shared/git-changes.mjs:9` defines `isIgnoredPath` with a _different_ regex from `ci-impact.mjs:272`'s `isIgnoredPath` (same name, different meaning: build output vs docs/markdown). Both are imported by sibling selectors.
- `checks/validation-impact.mjs` re-classifies paths (prose/config/etc.) that `ci-impact.mjs` also classifies (`GLOBAL_FILES`, `SPECIAL_OWNERS`, `:34`, `:52`), and `focused-validation-selection.mjs:469-:523` re-parses the root manifest again.
- `ci-impact.readChangedPaths` (`:304`) shells out to `git diff` itself instead of `shared/git-changes.mjs:47` `readGitState`.
- `focused-test-selection.mjs:16` `testRunner` re-derives each package's test command by string-comparing `pkg.scripts.test` to a template (`:28`); any `test` script edit silently flips the package to the "unsupported → run whole package" path.

Net: change inventory, ignore rules, workspace loading and ownership are implemented 2–3 times with subtly different semantics, which is why `focused-validation-selection.test.mjs` (759 lines) and `focused-test-selection.test.mjs` (497) must repeat the same fixtures.

### 2. Five CLI conventions

- `focused-validation-runner.mjs:3` hand-rolled `--base/--dry-run` parser with duplicate-flag detection; `testing/run-focused-tests.mjs` has its own near-copy (`parseArguments`, `executePlan`, `describePlan`) with the same flag set but different usage text and error type.
- `ci-impact.mjs:292` a third hand-rolled parser (`--base/--head/--full`).
- `storage-migrations/migrate.ts:9` and `validate-history.ts:128` use `node:util` `parseArgs`; `storage-migrations/run.mjs` is a dispatcher table over `.ts` files.
- `run-affected-packages.mjs:55` reads an env var (`NERVE_AFFECTED_PACKAGES`) rather than args; `pnpm exec` shell strings in `ci.yml:75`.
- Exit handling: `process.exitCode = 1` in 15 non-test places (`grep process.exitCode scripts`), `throw` + `console.error(error.message)` in `run-focused-tests.mjs`, and `focused-validation-runner.mjs:176` propagating codes. Three plan executors (`focused-validation-runner.mjs`, `run-focused-tests.mjs:executePlan`, `run-affected-packages.mjs`) each reimplement `spawnSync` + `result.error` + status check + log line.

### 3. Mixed tsx / node invocation and an untyped runtime

- Root scripts mix `node scripts/**/*.mjs` (`package.json:13-31`), `tsx scripts/development/dev-workbench.mjs` (`:24`) and `.ts` files launched through `storage-migrations/run.mjs` (child process). `dev-workbench.mjs` is `.mjs` but is run with `tsx` because it imports `.ts` helpers (`prepare-slot.ts`, `storage-preparation.ts`); `storage-copy.ts:4` imports `../development/storage-slot.mjs` across the mjs/ts boundary.
- ~6.6k lines of non-test `.mjs` (vs ~850 of non-test `.ts`) have no type checking. Plan objects (`{operation, mode, stages: {…}}`) are passed through four modules and validated by runtime guards (`isText`, `isTextArray`, `validateCommands` in `focused-validation-runner.mjs:~30`) that a type would replace.

### 4. **Tests that do not run** (highest-priority finding)

Both `package.json:21` (`test:full`), `ci.yml:75` and `focused-test-selection.mjs:244` run `node --test "scripts/**/*.test.mjs"`. These `.ts` tests match no runner I could find: `scripts/development/test/storage-slot.test.ts` (484 lines), `scripts/storage-migrations/{rehearse,rehearse-baseline,validate-history}.test.ts`, `test/storage-copy-options.test.ts`. Migration rehearsal and slot-safety logic are therefore untested in CI and in `test:focused` unless run by hand. A manual run of all five files (`pnpm exec tsx --test scripts/storage-migrations/test/storage-copy-options.test.ts scripts/storage-migrations/rehearse-baseline.test.ts scripts/storage-migrations/rehearse.test.ts scripts/storage-migrations/validate-history.test.ts scripts/development/test/storage-slot.test.ts`) passes 24/24, so wiring them in is low risk.

### 5. Policy encoded as bespoke code, partly untested

- `check-package-boundaries.mjs` is a 47-line list of nine bespoke check functions with different signatures (`checkPackageBoundaries`, `contractsSourcePolicyViolations`, `validatePackageExportSurfaces`, …) and different return shapes; adding a rule means editing the runner and inventing a result shape.
- Rule data is mixed with machinery in `ui-style-checks.mjs` (253) + `style-policy.mjs` (335) and `workbench-boundaries.mjs` (145, data) vs `workbench-boundary-checks.mjs` (141, checker); the split is done for one pair but not others.
- `workspace-architecture.mjs:1` hand-lists every package and allowed dependency while `ci-impact.loadWorkspace` derives them from manifests — two sources of truth for the same graph. `release/workspace-packages.mjs:26,40` is a third list (`versionLockedPackages`, `bundledPackages`).
- No tests: `check-built-package-exports.mjs`, `workspace-architecture.mjs`, `retired-surface-checks.mjs` (only through the repository-boundary test), all of `build/` and most of `release/` (`pack-npm` 272, `verify-npm-tarballs` 382, four smoke scripts ~720). Release scripts encode packaging policy and are exercised only on release.

### 6. Size and flag surface

- `focused-validation-selection.mjs` is 559 lines with a single ~280-line `selectFocusedValidation` (`:186`-`:~465`) containing all stage logic; `focused-test-selection.mjs:43` `selectFocusedTests` is ~250 lines. Both are hard to review.
- Flags: fix/check/test:focused all accept `--base`/`--dry-run`, but there is no `--json`, `--explain`, or `--only <stage>`; `README.md` (63 lines, with multi-hundred-character paragraphs) documents behaviour that exists only in code.
- Cross-package duplication: `packages/website/scripts/check-*.mjs`, `workbench-app/scripts/run-tests.mjs`, `native/scripts/check-internal-dependencies.mjs` each hand-roll file walking / arg handling that `repository-source-inventory.mjs` already abstracts for root.

### 7. Ownership drift

- `scripts/README.md` says "Do not add a generic `lib/`" and only admit `shared/` modules that multiple domains consume; today `shared/` has two files and the real shared code (`ci-impact.loadWorkspace`, `release/workspace-packages.mjs`) lives in domains, so `checks/` imports `testing/`. The rule is right; the placement is wrong.
- `workspace-packages.mjs` exports `repoRoot` (`:15`), and at least 4 non-test files derive the root with `resolve(dirname(fileURLToPath(import.meta.url)), "../..")` (`run-focused-fix.mjs`, `run-focused-tests.mjs`, `run-affected-packages.mjs`, …).

No obviously dead script was found (every file is reachable from a package script, workflow, or another script); `run-focused-fix.mjs`/`run-focused-checks.mjs` are 7-line shims that can fold into one CLI.

## Goals / non-goals

Goals

- One change-inventory + workspace-graph + ownership layer used by CI impact, fix, check and test selection.
- One tiny CLI/runtime helper (args, logging, spawn, exit), so every entry point has the same `--help`, error, and exit behaviour.
- One language: TypeScript run by `tsx`, checked by `tsc --noEmit`.
- Policy checks as data-driven rules with a uniform result shape; each rule has a fixture test.
- Every test under `scripts/` actually runs in CI and `test:focused`.
- Each step mergeable alone; user-visible commands and CI outputs unchanged.

Non-goals

- No change to which files `fix:focused`/`check:focused`/`test:focused` select (plans must stay byte-identical, see [Rollout](#rollout)).
- No new build tool, task runner (nx/turbo), or monorepo cache; no change to pnpm scripts' names.
- No refactor of package-local script trees beyond adopting the shared CLI helper opportunistically.
- No change to release behaviour; release scripts only get types and (later) tests.

## Design

### Language: TypeScript run by `tsx`, checked with `tsc`

Decision: `.ts` for all of `scripts/`, including `release/` and `build/` (consistency over per-directory exceptions), over JSDoc+checkJs. `tsx` is already a root dev dependency and used for `dev` and the migration scripts; the storage-migrations and slot code (~850 lines) is already `.ts`; plan/rule types are the main value and are far more readable as interfaces than as `@typedef`. Cost: `node --test` needs `--import tsx` (or `tsx --test`) and cold start is ~100–200ms higher. Mitigation: keep the three CI-critical entry points (`ci-impact`, `run-affected-packages`, `check-package-boundaries`) on `tsx` too; measure first (see [Speed](#speed)); if startup matters, add `NODE_OPTIONS=--import tsx` rather than reverting to `.mjs`. Add `scripts/tsconfig.json` (`noEmit`, `strict`, `allowImportingTsExtensions`, `types: ["node"]`) and a root `check` entry so type errors fail `pnpm check`/`check:focused` (known "scripts tooling" paths already select file-scoped checks).

### Layout

```text
scripts/
  cli/            # shared: the only cross-domain helper (README: admitted because every domain uses it)
    args.ts       # parseArgs wrapper: declared flags, --help, duplicate/unknown detection
    run.ts        # runStep/runSteps: spawn, inherit stdio, uniform failure → CliError
    main.ts       # defineCli(): catches CliError → message + exitCode, no stack by default
    log.ts        # section(reason), warn, dry-run formatting
  workspace/      # shared: repo root, manifests, graph, ownership
    repo.ts       # repoRoot (once), readJson
    graph.ts      # loadWorkspace, closures, packageForPath
    git.ts        # change inventory (from shared/git-changes), changed paths base...head
  impact/         # was ci-impact + validation-impact + focused-* selection
    rules.ts      # data: global paths, special owners, ignored, prose
    classify.ts   # paths → ImpactSet (packages, stages, flags)
    ci.ts         # GitHub outputs from ImpactSet
  checks/ testing/ build/ development/ storage-migrations/ release/   # unchanged responsibilities
```

`scripts/cli/` and `scripts/workspace/` replace `shared/` (rename, not a new `lib/`). Everything in `shared/` that is single-domain moves out (`workspace-architecture` → `checks/`).

### Shared runtime

```ts
// cli/args.ts
interface FlagSpec {
  type: "boolean" | "string";
  description: string;
  default?: unknown;
}
export function parseCli<T extends Record<string, FlagSpec>>(
  name: string,
  flags: T,
  argv: string[],
): ParsedFlags<T>;

// cli/run.ts
export interface Step {
  command: string;
  args: string[];
  reason: string;
  cwd?: string;
}
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}
export function runSteps(
  steps: Step[],
  opts: { dryRun?: boolean; spawn?: typeof spawnSync },
): void;

// cli/main.ts
export function defineCli(fn: (argv: string[]) => Promise<void> | void): void; // runs when invoked directly
```

`Step` already exists implicitly: `{command, args, reason}` in `run-focused-tests.mjs:executePlan` and the stage commands in `focused-validation-runner.mjs`. Standard flags `--base`, `--dry-run`, `--help` come from one `commonFlags`; `ci-impact` adds `--head`/`--full`. Preserve the current usage strings exactly in step 3 (tests assert them).

### One selection engine

```ts
// impact/classify.ts
export type Operation = "fix" | "check" | "test";
export interface ChangeSet {
  base: string;
  baseline?: string;
  paths: string[];
  manifestDelta?: RootManifestDelta;
  fallback?: string;
}
export interface Impact {
  packages: { changed: Set<string>; downstream: Set<string>; unknown: boolean };
  stages: {
    format: Scope;
    lint: Scope;
    policies: Scope;
    migrations: Scope;
    packages: Scope;
    native: Scope;
  };
  reasons: Map<string, string[]>;
}
export function classify(
  change: ChangeSet,
  workspace: Workspace,
  rules: ImpactRules,
): Impact;
```

`fix` and `check` become two thin planners that map `Impact` to `Step[]` (tool command lines: `oxfmt`, `eslint`, `pnpm --filter … check`), `test` adds the import-graph refinement on top (`test-import-graph.mjs` stays; it consumes `Impact.packages`), and `ci.ts` formats `Impact` as `GITHUB_OUTPUT` lines. `ImpactRules` is a plain data module (`GLOBAL_FILES`, `SPECIAL_OWNERS`, ignore regexes, prose patterns, now one `isIgnoredPath` meaning with two named variants: `isBuildOutput`, `isDocsOnly`). `selectFocusedValidation` splits by stage (`selectFormat`, `selectLint`, `selectPackages`, `selectNative`, …), each a pure function of `Impact`.

`testRunner` stops string-matching: the engine reads each package's runner (`tsx`/`node`, glob, options) from one data table next to the rules, and a unit test asserts the table agrees with every `package.json` `test` script. Decision: table plus agreement test rather than per-package manifest metadata, because it adds no manifest schema, keeps the knowledge in one reviewable place, and the test still fails loudly when a package script drifts.

### Policy checks as rules

```ts
// checks/policy.ts
export interface Violation {
  rule: string;
  file: string;
  line?: number;
  message: string;
}
export interface PolicyRule {
  id: string;
  description: string;
  check(inv: SourceInventory): Violation[];
}
export const rules: PolicyRule[] = [
  boundaries,
  workbenchLayers,
  uiStyle,
  retiredSurfaces,
  exportSurfaces,
  contractsSource,
  serverTestRuntime,
  sourceNaming,
];
```

`check-package-boundaries.ts` becomes ~15 lines: build inventory once, `rules.flatMap(r => r.check(inv))`, print grouped by rule, exit non-zero. Rule _data_ (allowed dependencies, layers, allowlists) lives in `*.rules.ts` data files next to each rule; `workspace-architecture` is replaced by deriving dependencies from manifests plus a data file for the _allowed_ edges only. Add `--rule <id>` and `--list` to the runner for local iteration. Testing: one `policy-rules.test.ts` that runs each rule over a tiny in-memory inventory fixture (a passing and a failing case per rule), replacing the ad-hoc per-file test setups where they are duplicates; keep existing tests that assert intricate behaviour (`style-policy`, boundaries).

### Tests

- Single glob `tsx --test "scripts/**/*.test.{ts,mjs}"` in `test:full`, `ci.yml:75`, and `focused-test-selection` (until all are `.ts`). Scripts tests stay in `test:full` locally and in CI.
- Plan-equivalence golden tests (see Rollout step 0): record `describePlan` output for ~20 representative change sets for all three operations before refactoring; steps 2–5 must keep them unchanged.
- Release scripts: pure parts (arg parsing, manifest/tarball assertion logic in `verify-npm-tarballs`) get fixture tests as the files are converted; smoke scripts stay untested by design (they are the tests).

## Speed

Local (`fix:focused`/`check:focused`/`test:focused`):

- Start-up: `focused-validation-selection.mjs:545` constructs an `ESLint` instance and checks ignores per file (`:553`) — a full ESLint config load (~1–3s) on every run. Replace with the ignore patterns from `eslint.config.js` read once, or run lint with `--no-warn-ignored` and let ESLint skip ignored files itself. Measure before deciding; keep behaviour identical.
- Run `format`/`lint` and `pnpm -r check` stages concurrently in `check` (read-only; today sequential via the stage loop in `focused-validation-runner.mjs`). `fix` must stay ordered (format → lint → format).
- `tsc` builds: `pnpm --filter … check` already uses project references; ensure `scripts/tsconfig.json` is `incremental` with `tsBuildInfoFile` under an ignored dir.
- `--only <stage>` flag to skip stages during inner loops.

CI split with [testing-improvements.md](./testing-improvements.md) section 0:

- **Testing doc owns** job structure in `ci.yml`: the parallel baseline/lint job (its item 5, including the serial `ci.yml:75` line), native artifact/cache, host-job split, coverage on `main`, duplicate builds.
- **This doc owns** the `ci-impact.mjs` code. Its item 4 (precise owners so script-only PRs are not `full`) is first a small data edit to `SPECIAL_OWNERS`/`isGlobalPath` in `ci-impact.mjs`; it can land before any refactor here. Step 5 below then moves that data into `impact/rules.ts` unchanged, so there is no ordering dependency in either direction.
- Replacing `ci-impact`'s own `git diff` (`readChangedPaths`, `:304`) with the shared change inventory makes local and CI classification the same engine (the main correctness win), and `ci-impact --explain` prints the same reasons as `--dry-run`.

## Rollout

Each step is an independent PR; every step keeps the golden plan outputs and CLI usage strings unchanged.

0. **Wire the orphaned tests and add the safety net.** Change the glob to include `.test.ts` (`package.json:21`, `ci.yml:75`, `focused-test-selection.mjs:22,244`); the five files already pass 24/24. In the same PR (or a follow-up) add `scripts/checks/test/plan-golden.test.ts` capturing `describePlan` for fix/check/test across ~20 synthetic change sets (docs-only, source in one package, root manifest script vs dependency, lockfile, native, unknown ownership, base unavailable). The `ci.yml:75` edit is a one-token change; coordinate with testing-improvements item 5 if that has split the line.
1. **Reserved** (formerly "run orphaned tests"; merged into step 0, numbering kept to avoid churn in references).
2. **`scripts/cli/` helper.** Add `args.ts`, `run.ts`, `main.ts`, `log.ts`; adopt in the three plan executors and `run-affected-packages` (they share `spawnSync` + error handling). Merge `run-focused-fix/checks` shims into `checks/focused.ts <fix|check>` keeping the root script names.
3. **Types for `scripts/`.** Add `scripts/tsconfig.json`; convert `shared/`, `checks/`, `testing/` to `.ts` mechanically (rename + annotate plan types); keep `.mjs` entry shims only if a workflow calls them directly, then update workflow paths in the same PR. Switch `node scripts/…` invocations to `tsx` in root scripts.
4. **`scripts/workspace/` layer.** Move `loadWorkspace`, closures, `packageForPath` out of `ci-impact`; make `git-changes` the sole change-inventory source (including `ci-impact`'s `readChangedPaths`); rename the two `isIgnoredPath` meanings; remove `checks/ → testing/` imports.
5. **One impact engine.** Extract `impact/rules.ts` (data) and `classify`; port `validation-impact`, `ci-impact.classifyChanges`, and the stage logic of `selectFocusedValidation`/`selectFocusedTests` onto it one operation at a time (check, then fix, then test, then CI) with the golden tests as the gate. Split `selectFocusedValidation` by stage.
6. **Policy rule registry.** Introduce `PolicyRule`/`Violation`; convert the eight checks one per PR (smallest first: `source-naming`, `server-test-runtime`, `contracts-source`). Add `--rule`/`--list`. Replace `workspace-architecture.mjs` with manifest-derived deps + allowed-edge data.
7. **Release and build typing/tests.** Convert `release/` and `build/` to `.ts`, add fixture tests for `verify-npm-tarballs` and `pack-npm` assertion logic, and share `workspace/repo.ts` instead of per-file root derivation. Release workflow paths updated in the same PR; verify with a `workflow_dispatch` dry run or the existing release checklist ([docs/runbooks/release.md](../runbooks/release.md)).
8. **Local speed changes** (can be interleaved after step 2): ESLint ignore check, parallel check stages, `--only <stage>`. Each measured before/after and reported in the PR. CI job structure is not part of this step (see testing-improvements section 0).
9. **README + AGENTS.** Shorten `scripts/README.md` to the layout table, the standard-flag contract, and links; move the long focused-validation semantics into doc comments beside `impact/rules.ts` where they are testable.
10. **Optional: package-local script trees.** Adopt `scripts/cli/` (args, spawn, exit handling) in `packages/{website,workbench-app,native,desktop-shell,contracts,workbench-server}/scripts/` one package per PR, only where it removes hand-rolled parsing; no behaviour changes. Safe to skip or defer.

## Deleted / simplified

- `run-focused-fix.mjs`, `run-focused-checks.mjs` (one CLI).
- Two of three hand-rolled arg parsers and three of four `spawnSync` loops; ~15 `process.exitCode` sites.
- Duplicate `isIgnoredPath`, `readChangedPaths`, root-manifest parsing, per-file `repoRoot` derivation.
- `shared/workspace-architecture.mjs` hand-maintained dependency list (derived from manifests).
- `testRunner` command-string comparison (`focused-test-selection.mjs:28`).
- Runtime plan validators (`isText`, `isTextArray`, `validateCommands`) replaced by types where inputs are internal.
- Expected: ~800–1,200 fewer non-test lines, mostly in selection/runner code.

## Risks & open questions

- **Behaviour drift in selection.** Mitigated by golden plans (step 0) and doing one operation per PR; accept that the golden set cannot cover every edge case already in the 759-line selection test, which also stays as the gate.
- **tsx startup cost** on CI-critical scripts; measure in step 3. Optional spike: Node ≥24 (`package.json` `engines`) can strip types natively, which may let us drop `tsx` for scripts without path aliases or enums; only worth it if the measured delta is >300ms. The decision stays "TS via `tsx`".
- **Release scripts** can only be fully verified on a release; since they are converted to TS too, keep step 7 to mechanical renames plus types behind a dry-run of the workflow and avoid logic changes.
- No open questions for the user remain; decisions above (TS everywhere, scripts tests stay in `test:full` and CI, table-plus-agreement test, package-local adoption as a final optional step) are settled.

## Effort

| Step                                 | Size                          |
| ------------------------------------ | ----------------------------- |
| 0 Wire `.ts` tests + golden plans    | S (0.5 day)                   |
| 1 Reserved (merged into 0)           | —                             |
| 2 CLI helper + shim merge            | S (0.5–1 day)                 |
| 3 TS conversion + tsconfig           | M (1–2 days, mechanical)      |
| 4 Workspace/git layer                | S–M (1 day)                   |
| 5 Impact engine                      | L (3–4 days; the risky one)   |
| 6 Policy registry                    | M (2 days across 8 small PRs) |
| 7 Release/build typing + tests       | M (2 days)                    |
| 8 Speed changes                      | S–M (1 day, measured)         |
| 9 Docs                               | S                             |
| 10 Package-local adoption (optional) | S per package                 |

Total ≈ 2 weeks of focused work (excluding optional step 10); steps 0–2 alone fix the worst issues (orphaned tests, duplicated CLI/spawn code) in about two days.
