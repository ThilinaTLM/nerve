# Repository scripts

Place repository tooling by responsibility; keep filenames descriptive and domain directories flat.

| Directory             | Responsibility                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development/`        | Repository-only slot selection, disposable storage preparation, and owned development process orchestration.                                                               |
| `build/`              | Asset generation and build assembly.                                                                                                                                       |
| `checks/`             | Focused fix/check orchestration, architecture, boundaries, policy validation, source inventory, and package-export surfaces.                                               |
| `testing/`            | CI impact analysis, focused selection/import graphs, and test orchestration.                                                                                               |
| `release/`            | Versioning, tagging, packaging, artifact verification, and release smoke checks (including Electron). Release-package inventories and native-prebuild helpers belong here. |
| `storage-migrations/` | Core importer and safe offline home-copy tools; command paths remain unchanged.                                                                                            |
| `shared/`             | Genuinely cross-domain repository metadata and Git change discovery (`workspace-architecture.mjs`, `git-changes.mjs`).                                                     |

Keep tests in a `test/` subdirectory of their owning domain (`*.test.mjs` or existing `*.test.ts`); create it only where tests exist. The recursive `scripts/**/*.test.mjs` glob discovers these tests. Do not add a generic `lib/`, global tests directory, or domain `lib/` nesting. Admit a module to `shared/` only when multiple domains genuinely consume it; shared implementation must not import domain entrypoints. Domain-owned helpers stay with their domain even when another domain imports them.

Prefer the stable pnpm commands in [package.json](../package.json). Normal code completion uses `pnpm fix:focused && pnpm check:focused` plus relevant unit tests; docs-only changes need diff review only. Run broader test suites only when requested; CI covers them.

## Focused validation

Focused commands default to `--base origin/main` (merge-base with HEAD plus staged, unstaged, and untracked nonignored changes). Use `--base HEAD` for local changes only and `--dry-run` to preview each stage's scope, targets, reasons, and commands without execution. Formatting, linting, package/type checks, and native Rust work are selected independently:

- Ordinary source edits select supported changed files for formatting/linting and owning packages plus downstream consumers for package checks. Rust runs only for relevant native inputs.
- Root `package.json` is compared semantically against the Git baseline: whitespace/key ordering, descriptive metadata, and ordinary scripts do not broaden stages. Validation/build scripts select the stages they govern. Dependencies broaden package checks; formatter/linter dependencies additionally broaden their relevant file stages.
- Unknown ownership broadens package checks only, not formatting, linting, or Rust. Invalid workspace metadata or unsupported declaration preparation fails clearly without widening file scopes. Known check/testing/shared/migration tooling stays file-scoped apart from global policy/migration checks; workflow YAML and contributor prose normally affect only changed-file formatting.
- Formatter config/ignore changes broaden formatting; ESLint config broadens linting. Shared TypeScript config broadens linting and package checks; package TypeScript config selects its owner and downstream packages for both. Workspace/runtime settings broaden package checks, with relevant tool settings also broadening file stages.
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and package-manager/override/resolution changes conservatively broaden all npm formatting, linting, and package checks because tool/dependency resolution is uncertain—not unrelated Rust work. Formatter ignores still apply; no lockfile graph analysis is attempted.

Policy/migration checks remain global for non-prose/config/runtime changes; prose-only selection needs no package/policy work. Docs-only completion still requires diff review only.

Only unavailable Git/base or change inventory triggers a whole-command fallback to full `pnpm fix`/`pnpm check`, with a warning: **full fix can mutate files repository-wide**. Repository-wide format/lint autofix also warns. Fix runs formatting, lint autofix, then formatting again; repository-wide lint autofix requires that final formatting pass to cover the full repository. Configuration/planning errors and tool failures fail clearly rather than retrying as full validation.

Full commands remain available for explicit broad validation. Focused checks do not run tests or replace full validation; CI/release requirements are unchanged.

See [Contributing](../CONTRIBUTING.md) for test selection and validation, and the [release checklist](../docs/runbooks/release.md) for direct release commands. Package-local script trees are outside this layout.

Daily development: `pnpm desktop:dev`, `pnpm dev`, and `pnpm dev:ui` accept `--slot N`. `pnpm storage:copy --slot N` seeds an unused disposable slot from a stopped `~/.nerve`. Add `--from <path>` to copy another stopped home instead: `pnpm storage:copy --from data/storage-0-34-1-do-not-use --slot 4` or `pnpm storage:copy --from data/storage-2 --slot 4`. Relative source paths resolve from the working directory. The destination must be unused; desktop profiles are not copied. Copied credentials and project paths can still access real providers/files, so storage isolation is not a sandbox. `pnpm desktop:prod` explicitly launches source code against real user data. Home migrations run before startup storage opens; `pnpm storage:migrate --home <copied-home> [--dry-run]` rehearses the same runner against a stopped copy. Step 0001 replaces the legacy database with conversation core at `data/nerve.sqlite`; later pure core schema migrations run when that database opens.

### Storage migration rehearsal

`pnpm storage:rehearse --from /absolute/baseline-home --slot 3 [--corrupt PRESET] [--keep]`
copies a stopped baseline with `cloneNerveHome`, redirects registered legacy
projects to `data/storage-3-projects/<basename>` (only `.nerve` is copied), and
writes `data/storage-3-baseline.sha`. Slot 1 is always refused. Existing homes
and project copies require `--force-reset` (both are then removed under the slot lock).
Project basename collisions and symbolic links are refused rather than merged.

Presets are `config`, `overlay`, `conversation`, `message`, `runtime-json`, and
`runtime-shape`; selection is deterministic and missing inputs are errors.
Checksums cover the copied home and project configuration **after** redirection
and corruption. Follow the printed start/restore commands, stop the daemon after
restoration, then run `sha256sum -c data/storage-3-baseline.sha` from the checkout.
The script never starts a server or drives destructive recovery automatically.
Copies remain available for inspection; `--keep` suppresses the printed cleanup
command. Credentials are copied: this is storage isolation, not a provider sandbox.
