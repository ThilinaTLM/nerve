# Repository scripts

Place repository tooling by responsibility; keep filenames descriptive and domain directories flat.

| Directory             | Responsibility                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development/`        | Repository-only slot selection, disposable storage preparation, and owned development process orchestration.                                                               |
| `build/`              | Asset generation and build assembly.                                                                                                                                       |
| `checks/`             | Architecture, boundaries, policy validation, source inventory, and package-export surfaces.                                                                                |
| `testing/`            | CI impact analysis, focused selection/import graphs, and test orchestration.                                                                                               |
| `release/`            | Versioning, tagging, packaging, artifact verification, and release smoke checks (including Electron). Release-package inventories and native-prebuild helpers belong here. |
| `storage-migrations/` | Core importer and safe offline home-copy tools; command paths remain unchanged.                                                                                            |
| `shared/`             | Genuinely cross-domain repository metadata; currently only `workspace-architecture.mjs`.                                                                                   |

Keep tests in a `test/` subdirectory of their owning domain (`*.test.mjs` or existing `*.test.ts`); create it only where tests exist. The recursive `scripts/**/*.test.mjs` glob discovers these tests. Do not add a generic `lib/`, global tests directory, or domain `lib/` nesting. Admit a module to `shared/` only when multiple domains genuinely consume it; shared implementation must not import domain entrypoints. Domain-owned helpers stay with their domain even when another domain imports them.

Prefer the stable pnpm commands in [package.json](../package.json): `pnpm build`, `pnpm check`, `pnpm test:focused`, and `pnpm run test:full`. See [Contributing](../CONTRIBUTING.md) for test selection and validation, and the [release checklist](../docs/runbooks/release.md) for direct release commands. Package-local script trees are outside this layout.

Daily development: `pnpm desktop:dev`, `pnpm dev`, and `pnpm dev:ui` accept `--slot N`. `pnpm storage:copy --slot N` seeds an unused disposable slot from a stopped `~/.nerve`. `pnpm desktop:prod` explicitly launches source code against real user data. Home migrations run before startup storage opens; `pnpm storage:migrate --home <copied-home> [--dry-run]` rehearses the same runner against a stopped copy. Step 0001 replaces the legacy database with conversation core at `data/nerve.sqlite`; later pure core schema migrations run when that database opens.
