/**
 * Impact rules: the single, reviewable home for "which files affect what".
 * Pure data and documentation; the logic lives in `classify.ts`.
 *
 * ## Focused validation semantics (`fix:focused`, `check:focused`)
 *
 * - Commands default to `--base origin/main`: the merge-base with HEAD plus
 *   staged, unstaged and untracked nonignored changes. `--base HEAD` selects
 *   local changes only; `--dry-run` prints every stage's scope, targets,
 *   reasons and commands without executing.
 * - Formatting, linting, package/type checks, policies, migrations and native
 *   Rust work are selected independently (see `Impact` in `classify.ts`).
 * - Ordinary source edits select the supported changed files for formatting
 *   and linting, and the owning packages plus downstream consumers for
 *   package checks. Rust runs only for relevant native inputs.
 * - The root `package.json` is compared semantically against the Git
 *   baseline: whitespace, key ordering, descriptive metadata
 *   ({@link ROOT_MANIFEST_METADATA}) and ordinary scripts do not broaden
 *   stages. Validation/build scripts select the stages they govern.
 *   Dependencies broaden package checks; formatter/linter dependencies
 *   ({@link FORMAT_TOOLS}, {@link LINT_TOOLS}) also broaden their file stages.
 * - Unknown ownership broadens package checks only, never formatting, linting
 *   or Rust. Invalid workspace metadata fails clearly instead of widening
 *   file scopes. Known tooling ({@link TOOLING_SCRIPT_PREFIXES}) stays
 *   file-scoped apart from the global policy/migration checks; workflow YAML
 *   and contributor prose normally affect only changed-file formatting.
 * - Formatter config/ignore changes broaden formatting; ESLint config
 *   broadens linting. Shared TypeScript config broadens linting and package
 *   checks; package TypeScript config selects its owner and downstream
 *   packages for both.
 * - `pnpm-lock.yaml`, `pnpm-workspace.yaml` and package-manager/override/
 *   resolution changes conservatively broaden all npm formatting, linting and
 *   package checks, never unrelated Rust work. No lockfile graph analysis.
 * - Policy and migration checks stay global for any non-prose change.
 * - Only an unavailable Git base/inventory falls back to full `pnpm fix` /
 *   `pnpm check`, with a warning (full fix can mutate files repository-wide).
 *   Configuration, planning and tool failures fail clearly, never retry as
 *   full validation.
 *
 * ## CI semantics (`ci.ts`)
 *
 * A pull request is `full` when it touches a global path ({@link GLOBAL_FILES},
 * workflows, root TypeScript/ESLint config, a non-tooling `scripts/` path) or
 * a path with unknown ownership. Docs-only paths and developer tooling select
 * nothing beyond the always-on lint job.
 */

export const CORE_PACKAGES: ReadonlySet<string> = new Set([
  "@nervekit/contracts",
  "@nervekit/desktop-shell",
  "@nervekit/harness",
  "@nervekit/native",
  "@nervekit/protocol",
  "@nervekit/skills",
  "@nervekit/tools",
  "@nervekit/conversation-core",
  "@nervekit/ui-kit",
  "@nervekit/workbench-app",
  "@nervekit/workbench-server",
]);

export const HOST_PACKAGES: ReadonlySet<string> = new Set([
  "@nervekit/native",
  "@nervekit/harness",
  "@nervekit/skills",
  "@nervekit/tools",
  "@nervekit/conversation-core",
  "@nervekit/workbench-server",
]);

export const WORKBENCH_PACKAGES: ReadonlySet<string> = new Set([
  "@nervekit/workbench-app",
  "@nervekit/workbench-server",
]);

/** Root files whose change can affect everything CI builds or tests. */
export const GLOBAL_FILES: ReadonlySet<string> = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  ".nvmrc",
  "eslint.config.js",
  "tsconfig.base.json",
]);

/** Root documents that never affect CI. */
export const DOCS_ONLY_ROOT_FILES: ReadonlySet<string> = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "NOTICE",
]);

/** A repository file owned by specific packages although it lives outside `packages/`. */
export interface SpecialOwner {
  owners: readonly string[];
  /** Whether a change also needs the Electron image smoke test. */
  electronSmoke?: boolean;
}

export const SPECIAL_OWNERS: ReadonlyMap<string, SpecialOwner> = new Map([
  [
    "scripts/build/copy-workbench-app-dist-to-workbench-server.ts",
    { owners: ["@nervekit/workbench-app", "@nervekit/workbench-server"] },
  ],
  ["scripts/build/copy-skills-assets.mjs", { owners: ["@nervekit/skills"] }],
  [
    "scripts/release/smoke-workbench-release.ts",
    { owners: ["@nervekit/workbench-app", "@nervekit/workbench-server"] },
  ],
  [
    "scripts/release/smoke-electron-image-resize.ts",
    { owners: ["@nervekit/harness"], electronSmoke: true },
  ],
  [
    "scripts/build/generate-brand-assets.mjs",
    { owners: ["@nervekit/desktop-shell"] },
  ],
]);

/** Repository paths (outside `packages/`) owned by the brand asset pipeline. */
export const BRAND_ASSET_PREFIX = "assets/brand/";
export const BRAND_ASSET_OWNER = "@nervekit/desktop-shell";

/**
 * Developer tooling whose only CI consumer is the always-on lint job (format,
 * lint, policies and the `scripts/**` tests). It never reaches a product
 * package, so it must not escalate to full coverage and has no package owner
 * for focused validation. Build and release scripts stay unknown on purpose:
 * they change what CI builds and ships.
 */
export const TOOLING_SCRIPT_PREFIXES: readonly string[] = [
  "scripts/checks/",
  "scripts/cli/",
  "scripts/development/",
  "scripts/impact/",
  "scripts/storage-migrations/",
  "scripts/testing/",
  "scripts/workspace/",
];

export const TOOLING_ROOT_FILES: ReadonlySet<string> = new Set([
  ".c8rc.json",
  ".gitattributes",
  ".gitignore",
  ".oxfmtrc.json",
]);

// ── Native CI matrix ────────────────────────────────────────────────────────

/** Platform order for native jobs; host work is split into parallel suites. */
export const NATIVE_OSES: readonly string[] = [
  "windows-latest",
  "macos-latest",
];

/**
 * Storage migration tests run with --test-concurrency=1 and dominate the
 * Windows/macOS host path, so they are sharded with Node's --test-shard.
 */
export const MIGRATION_SHARDS = 2;

export interface HostSuite {
  suite: string;
  shard?: string;
}

export const HOST_SUITES: readonly HostSuite[] = [
  { suite: "host-native" },
  { suite: "host-server" },
  { suite: "host-tools" },
  ...Array.from({ length: MIGRATION_SHARDS }, (_, index) => ({
    suite: "host-migrations",
    shard: `${index + 1}/${MIGRATION_SHARDS}`,
  })),
];

// ── Focused validation: file kinds ──────────────────────────────────────────

/** Oxfmt 0.58 supports these extensions, but not Astro or Rust. */
export const FORMAT_EXTENSIONS: ReadonlySet<string> = new Set(
  "js jsx mjs cjs ts tsx mts cts json jsonc json5 yaml yml toml html htm vue svelte css scss less md markdown mdx graphql gql hbs handlebars".split(
    " ",
  ),
);

export const LINT_EXTENSIONS: ReadonlySet<string> = new Set(
  "js jsx mjs cjs ts tsx mts cts svelte".split(" "),
);

// ── Focused validation: root manifest comparison ────────────────────────────

/** Descriptive root manifest fields that never change any stage. */
export const ROOT_MANIFEST_METADATA: ReadonlySet<string> = new Set([
  "name",
  "version",
  "private",
  "description",
  "author",
  "contributors",
  "license",
  "repository",
  "homepage",
  "bugs",
  "keywords",
  "funding",
  "files",
  "publishConfig",
]);

export const DEPENDENCY_GROUPS: ReadonlySet<string> = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

/** Installed Oxfmt/Svelte formatting inputs. */
export const FORMAT_TOOLS: ReadonlySet<string> = new Set(["oxfmt", "svelte"]);

/** Installed ESLint typed/Svelte configuration inputs. */
export const LINT_TOOLS: ReadonlySet<string> = new Set([
  "eslint",
  "@eslint/js",
  "eslint-plugin-svelte",
  "globals",
  "typescript-eslint",
  "typescript",
  "svelte",
]);

/** Root scripts that govern the validation stages (see the manifest comparison). */
export const VALIDATION_SCRIPTS_FIX: readonly string[] = [
  "fix",
  "fix:focused",
  "check",
  "check:focused",
];
export const BUILD_SCRIPTS: readonly string[] = [
  "build",
  "build:native",
  "build:workbench-runtime",
];
/** Root fields whose change means tool/dependency-resolution uncertainty. */
export const RESOLUTION_FIELDS: readonly string[] = [
  "packageManager",
  "pnpm",
  "overrides",
  "resolutions",
];

// ── Focused validation: path patterns ───────────────────────────────────────

export const FORMATTER_CONFIG =
  /(?:^|\/)(?:\.editorconfig|\.gitignore|\.oxfmtrc(?:\.[^/]+)?|\.oxfmtignore|\.prettierignore|\.prettierrc(?:\.[^/]+)?|prettier\.config\.[^/]+)$/;
export const ESLINT_CONFIG = /(?:^|\/)eslint(?:\.[^/]+)?\.(?:js|mjs|cjs)$/;
export const SHARED_TSCONFIG = /^tsconfig(?:\.[^/]+)?\.json$/;
export const NATIVE_TOOLCHAIN =
  /^(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.?rustfmt\.toml|\.cargo\/config(?:\.toml)?)$/;
export const PACKAGE_TSCONFIG =
  /^packages\/[^/]+\/(?:.*\/)?tsconfig(?:\.[^/]+)?\.json$/;
export const NATIVE_RUST_INPUT =
  /^packages\/native\/native\/(?:.*\.rs|(?:.*\/)?(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.?rustfmt\.toml|\.cargo\/config(?:\.toml)?))$/;
/** Markdown the runtime ships (skills, assets, test fixtures) is not prose. */
export const RUNTIME_MARKDOWN = /^packages\/[^/]+\/(?:src|assets|test)\//;
