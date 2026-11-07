# Repository scripts

Repository tooling is TypeScript, run by `tsx` (`pnpm <script>`) and type-checked by `tsc -p scripts` (part of `pnpm check`, selected by `pnpm check:focused` when scripts change). Prefer the stable pnpm commands in [package.json](../package.json). Normal code completion uses `pnpm fix:focused && pnpm check:focused` plus relevant unit tests; docs-only changes need diff review only. Run broader suites only when requested; CI covers them.

| Directory             | Responsibility                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli/`                | The only cross-domain runtime helper: flag parsing, subprocess steps, uniform error/exit handling, logging. Every entry point uses it.                 |
| `workspace/`          | Repository root, manifest types, the package dependency graph and Git change inventory shared by CI, fix, check and test selection.                    |
| `impact/`             | One path-impact engine: rules (data and the focused-validation semantics), classification into CI areas and validation stages, GitHub Actions outputs. |
| `checks/`             | Focused fix/check orchestration and repository policy rules (`policy-rules.ts` is the registry).                                                       |
| `testing/`            | Focused test selection, import graph, per-package runner table, test orchestration.                                                                    |
| `development/`        | Repository-only slot selection, disposable storage preparation, owned development process orchestration.                                               |
| `build/`              | Asset generation and build assembly.                                                                                                                   |
| `release/`            | Versioning, tagging, packaging, artifact verification and release smoke checks (including Electron).                                                   |
| `storage-migrations/` | Core importer and safe offline home-copy tools; see its [README](storage-migrations/README.md) for slots, copies and rehearsal.                        |

Package-local script trees (`packages/*/scripts/`) are outside this layout.

## Conventions

- Tests live in a `test/` subdirectory of their domain as `*.test.ts` (or beside the code for storage-migrations); `pnpm test:scripts` runs `scripts/**/*.test.ts` and CI runs it in the lint job. Run a single file with `pnpm exec tsx --test scripts/<domain>/test/<file>.test.ts`.
- No generic `lib/`, global tests directory or domain `lib/` nesting. A module belongs in `cli/` or `workspace/` only when several domains consume it; shared code must not import domain entry points.
- Entry points use `defineCli(import.meta.url, main)` so modules stay importable. Expected failures throw `CliError` (message only, no stack).
- Modules launched by CI before `pnpm install` (`impact/ci.ts` and its imports) and by release workflows run under plain Node's type stripping: erasable TypeScript only (no enums, namespaces or parameter properties) and `.ts` import specifiers.

## Transcript benchmark

`development/transcript-bench.ts` (thin entry; modules in `development/transcript-bench/`: `cdp`, `network`, `measure`, `open`, `stream`) measures transcript performance in a running desktop dev instance (`pnpm run desktop:dev --slot N`, CDP on `127.0.0.1:9222`) over raw CDP (`ws`), driving the real UI with trusted input. It never changes app code or starts a daemon, and it writes raw results and CPU profiles to `--out` (default `/tmp/nerve-bench`), never the repo.

```sh
# Large open: click → first transcript row, median of N, with network/scripting/layout split.
pnpm exec tsx scripts/development/transcript-bench.ts --scenario open --runs 5 --no-network \
  --conversation conv_… --search "words from its title" --project nerve [--reload]
# Streaming: fixed tool-heavy prompt in a new conversation (uses the real model, costs tokens).
pnpm exec tsx scripts/development/transcript-bench.ts --scenario stream --project Random \
  --model "Haiku 5.5" --runs 1 [--profile] --no-network
```

Notes: `--no-network` skips CDP Network capture (it copies every WebSocket frame and inflates the open time); `--profile` records a V8 CPU profile (sampling overhead inflates absolute times, so take long-task numbers from a run without it). The run counts as the app's production-minified bundle when `desktop:dev` serves `packages/workbench-server/dist/web`. Compare against `docs/proposals/transcript-streaming-performance.md`.

## Standard flags

`fix:focused`, `check:focused` and `test:focused` accept the same flags; duplicate, unknown or valueless flags print the usage line and exit non-zero.

| Flag                 | Meaning                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base <revision>`  | Compare against the merge-base of `<revision>` and HEAD plus local changes (default `origin/main`; `HEAD` = local only).                                                                       |
| `--dry-run`          | Print every stage's scope, targets, reasons and commands without executing.                                                                                                                    |
| `--only <stage[,…]>` | `fix:focused`/`check:focused` only: run just these stages (`prepare format lint policies migrations packages native`). Declaration preparation is kept when `lint` or `packages` is requested. |

Other entry points declare their flags with `parseCli` (`--help` lists them): `check-package-boundaries.ts [--rule <id>] [--list]`, `impact/ci.ts [--base <rev>] [--head <rev>] [--full]`.

`check:focused` runs declaration preparation first, then format, lint, policies, packages and native concurrently (output is buffered per stage and printed in plan order) and migration integrity last, because it builds outputs the others read. `fix:focused` stays strictly ordered (format, lint autofix, format).

## Selection semantics

Which files select which stages, the root-manifest comparison, fallback rules and the CI `full` triggers are documented, with their data, in [`impact/rules.ts`](impact/rules.ts); the behaviour is pinned by `impact/test/` and the golden plans in `checks/test/plan-golden.test.ts` (regenerate intentionally with `UPDATE_GOLDEN=1` and review the diff). Test selection reads each package's runner from [`testing/test-runners.ts`](testing/test-runners.ts), which a test keeps in agreement with every `package.json` `test` script.

## Policy rules

`checks/policy-rules.ts` registers every repository policy as a `PolicyRule` (`id`, `description`, `check(inventory) → Violation[]`). `pnpm exec tsx scripts/checks/check-package-boundaries.ts --list` shows them; `--rule <id>` runs one. Add a rule by writing it with `defineRule`/`defineFileRule` next to its data and listing it in the registry; `checks/test/policy-rules.test.ts` holds a passing and a failing in-memory fixture per rule. Allowed workspace dependency edges are data in `checks/package-architecture.rules.ts`; the package inventory itself is derived from manifests.

See [Contributing](../CONTRIBUTING.md) for test selection and validation, and the [release checklist](../docs/runbooks/release.md) for direct release commands.
