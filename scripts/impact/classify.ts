/**
 * The impact engine: paths (plus workspace graph and an optional root-manifest
 * delta) in, pure impact descriptions out. Consumers are thin:
 *
 * - `classifyChanges`: which CI areas run (used by `impact/ci.ts` and by the
 *   package selection of `fix`/`check`/`test`).
 * - `classifyValidationImpact`: which focused-validation stages are affected
 *   (used by the fix/check planners).
 *
 * Both are built on the same path predicates ({@link isProse},
 * {@link isToolingPath}, {@link isGlobalPath}) and the data in
 * `rules.ts`, which also documents the selection semantics.
 */
import { isDeepStrictEqual } from "node:util";
import type { PackageManifest } from "../workspace/repo.ts";
import { sep } from "node:path";
import {
  dependencyClosure,
  packageForPath,
  reverseDependencyClosure,
  type Workspace,
} from "../workspace/graph.ts";
import {
  BRAND_ASSET_OWNER,
  BRAND_ASSET_PREFIX,
  BUILD_SCRIPTS,
  CI_WORKFLOW,
  CORE_PACKAGES,
  DEPENDENCY_GROUPS,
  ESLINT_CONFIG,
  FORMATTER_CONFIG,
  FORMAT_TOOLS,
  GLOBAL_FILES,
  HOST_PACKAGES,
  LINT_TOOLS,
  MIGRATION_INPUT_PACKAGES,
  MIGRATION_SERVER_PATH,
  NATIVE_OSES,
  NATIVE_RUST_INPUT,
  NATIVE_TOOLCHAIN,
  PACKAGE_TSCONFIG,
  RESOLUTION_FIELDS,
  ROOT_MANIFEST_METADATA,
  RUNTIME_MARKDOWN,
  SHARED_TSCONFIG,
  SPECIAL_OWNERS,
  TEST_ONLY_PATH,
  TOOLING_ROOT_FILES,
  TOOLING_SCRIPT_PREFIXES,
  VALIDATION_SCRIPTS_FIX,
  WORKBENCH_PACKAGES,
} from "./rules.ts";

// ── Path predicates ─────────────────────────────────────────────────────────

/** Contributor prose that needs no package, policy or migration work (formatting only). */
export function isProse(path: string): boolean {
  return (
    ["LICENSE", "NOTICE"].includes(path) ||
    (path.endsWith(".md") &&
      !path.startsWith("packages/website/") &&
      (!RUNTIME_MARKDOWN.test(path) || path.endsWith("/AGENTS.md")))
  );
}

/** Developer tooling with no product-package consumer (see `TOOLING_SCRIPT_PREFIXES`). */
export function isToolingPath(path: string): boolean {
  if (SPECIAL_OWNERS.has(path)) return false;
  return (
    TOOLING_ROOT_FILES.has(path) ||
    TOOLING_SCRIPT_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    /^scripts\/(?:[^/]+\/)*test\//.test(path) ||
    /^scripts\/(?:.+\/)?[^/]+\.test\.ts$/.test(path) ||
    (path.startsWith(".github/") && path !== CI_WORKFLOW)
  );
}

/** Test files and per-package test trees: they affect only their own package. */
export function isTestOnlyPath(path: string): boolean {
  return TEST_ONLY_PATH.test(path);
}

/** Paths that can affect everything CI builds or tests. */
export function isGlobalPath(path: string): boolean {
  return (
    GLOBAL_FILES.has(path) ||
    path === CI_WORKFLOW ||
    SHARED_TSCONFIG.test(path) ||
    /^eslint(?:\.[^/]+)?\.(?:js|mjs|cjs)$/.test(path) ||
    (path.startsWith("scripts/") &&
      !SPECIAL_OWNERS.has(path) &&
      !isToolingPath(path))
  );
}

// ── CI impact ───────────────────────────────────────────────────────────────

/** One native job: an OS and the suites it runs (see `NATIVE_SUITES`). */
export interface NativeMatrixEntry {
  os: string;
  name: string;
  suites: string[];
}

export interface CiImpact {
  full: boolean;
  packages: string[];
  dependencyPackages: string[];
  website: boolean;
  workbench: boolean;
  native: boolean;
  nativeHost: boolean;
  nativeDesktop: boolean;
  nativeMatrix: NativeMatrixEntry[];
  nativeMatrixNeeded: boolean;
}

const intersects = (left: Set<string>, right: ReadonlySet<string>) =>
  [...left].some((value) => right.has(value));
const sorted = (values: string[]) =>
  values.sort((left, right) => left.localeCompare(right));
const normalizePath = (path: string) =>
  path.split(sep).join("/").replace(/^\.\//, "");

export function classifyChanges(
  changedPaths: readonly string[],
  workspace: Workspace,
  options: { full?: boolean; rootManifest?: RootManifestDelta } = {},
): CiImpact {
  const paths = changedPaths
    .map(normalizePath)
    .filter((path) => path.length > 0);
  let full = options.full === true;
  const direct = new Set<string>();
  // Packages with test-only changes: affected themselves, not their dependents.
  const testOnly = new Set<string>();
  let migrations = false;
  let website = false;

  for (const path of paths) {
    // Prose and `docs/` assets (any type) never affect CI.
    if (isProse(path) || path.startsWith("docs/")) continue;
    if (path === "package.json") {
      // Only a semantic change beyond metadata and ordinary scripts is global.
      if (
        diffRootManifest(options.rootManifest).some(
          (change) => change.kind !== "script" || isGovernedScript(change.name),
        )
      )
        full = true;
      continue;
    }
    if (isGlobalPath(path)) {
      full = true;
      continue;
    }
    if (isToolingPath(path)) continue;

    const packageName = packageForPath(path, workspace);
    if (packageName) {
      const isTest = isTestOnlyPath(path);
      (isTest ? testOnly : direct).add(packageName);
      if (
        (packageName === "@nervekit/workbench-server" &&
          MIGRATION_SERVER_PATH.test(path)) ||
        (!isTest && MIGRATION_INPUT_PACKAGES.has(packageName))
      )
        migrations = true;
      if (packageName === "@nervekit/website") website = true;
      if (path.startsWith("packages/ui-kit/src/styles/")) website = true;
      continue;
    }

    const special = SPECIAL_OWNERS.get(path);
    if (special) {
      for (const owner of special.owners) direct.add(owner);
      continue;
    }
    if (path.startsWith(BRAND_ASSET_PREFIX)) {
      direct.add(BRAND_ASSET_OWNER);
      continue;
    }

    // Unknown executable/configuration ownership must never silently skip CI.
    full = true;
  }

  if (full) {
    for (const packageName of workspace.keys()) direct.add(packageName);
    website = true;
    migrations = true;
  }

  const affected = reverseDependencyClosure(direct, workspace);
  for (const packageName of testOnly) affected.add(packageName);
  const corePackages = sorted(
    [...affected].filter((packageName) => CORE_PACKAGES.has(packageName)),
  );
  const dependencyPackages = sorted(
    [...dependencyClosure(affected, workspace)].filter(
      (packageName) =>
        CORE_PACKAGES.has(packageName) && !affected.has(packageName),
    ),
  );
  const workbench = intersects(affected, WORKBENCH_PACKAGES);
  const nativeHost = intersects(affected, HOST_PACKAGES);
  const nativeDesktop = affected.has("@nervekit/desktop-shell");
  const native =
    full ||
    workbench ||
    nativeHost ||
    nativeDesktop ||
    dependencyPackages.includes("@nervekit/native") ||
    corePackages.includes("@nervekit/native");
  const suites = [
    affected.has("@nervekit/native") && "native",
    affected.has("@nervekit/tools") && "tools",
    affected.has("@nervekit/workbench-server") && "server",
    migrations && "migrations",
    nativeDesktop && "desktop",
  ].filter((suite): suite is string => typeof suite === "string");
  // One job per OS runs the selected suites (and one addon build per OS).
  const nativeMatrix: NativeMatrixEntry[] =
    suites.length === 0
      ? []
      : NATIVE_OSES.map(({ os, name }) => ({ os, name, suites }));
  return {
    full,
    packages: corePackages,
    dependencyPackages,
    website,
    workbench,
    native,
    nativeHost,
    nativeDesktop,
    nativeMatrix,
    nativeMatrixNeeded: nativeMatrix.length > 0,
  };
}

// ── Focused-validation impact ───────────────────────────────────────────────

export type Scope = "none" | "changed" | "packages" | "all";
export type ImpactStage = "format" | "lint" | "packages" | "native";

export interface StageImpact {
  scope: Scope;
  reasons: string[];
}

/** Root `package.json` before/after the baseline, or why no comparison exists. */
export interface RootManifestDelta {
  before?: PackageManifest | null;
  after?: PackageManifest | null;
  reason?: string;
}

export interface ValidationImpact {
  format: StageImpact;
  lint: StageImpact;
  packages: StageImpact;
  native: StageImpact;
  /** Package-owned paths (and special owners) that select packages by ownership. */
  packageInputs: string[];
  /** Package tsconfig paths that scope typed lint to their package closure. */
  lintPackageInputs: string[];
  /** Whether any non-prose path changed (policies and migrations stay global). */
  nonProse: boolean;
  /** Whether repository scripts (or the TypeScript config they extend) changed. */
  typecheckScripts: boolean;
}

/** A manifest field known to be an object of entries (dependency group, scripts). */
const entries = (value: unknown) => (value ?? {}) as Record<string, unknown>;

/** One semantic difference between the root manifests (see {@link diffRootManifest}). */
export type RootManifestChange =
  | { kind: "unavailable"; reason: string }
  | { kind: "script"; name: string }
  | { kind: "dependency"; group: string; name: string }
  | { kind: "resolution"; field: string }
  | { kind: "other"; field: string };

/** Whether a root script governs validation or the build (others are ordinary). */
export const isGovernedScript = (name: string): boolean =>
  VALIDATION_SCRIPTS_FIX.includes(name) || BUILD_SCRIPTS.includes(name);

const keysOf = (...records: unknown[]) =>
  new Set(records.flatMap((record) => Object.keys(entries(record))));

/**
 * Semantic root `package.json` comparison shared by CI and focused validation:
 * whitespace, key order and descriptive metadata never count. An unavailable
 * comparison is a single `unavailable` change.
 */
export function diffRootManifest(
  delta: RootManifestDelta | undefined,
): RootManifestChange[] {
  const { before, after, reason } = delta ?? {};
  if (after != null && (typeof after !== "object" || Array.isArray(after))) {
    throw new Error("Invalid current root package.json: expected an object.");
  }
  if (!before || !after) {
    return [
      {
        kind: "unavailable",
        reason: reason ?? "Root manifest semantic comparison unavailable.",
      },
    ];
  }
  const changes: RootManifestChange[] = [];
  for (const field of keysOf(before, after)) {
    const left = (before as Record<string, unknown>)[field];
    const right = (after as Record<string, unknown>)[field];
    if (isDeepStrictEqual(left, right) || ROOT_MANIFEST_METADATA.has(field))
      continue;
    if (field === "scripts" || DEPENDENCY_GROUPS.has(field)) {
      for (const name of keysOf(left, right)) {
        if (isDeepStrictEqual(entries(left)[name], entries(right)[name]))
          continue;
        changes.push(
          field === "scripts"
            ? { kind: "script", name }
            : { kind: "dependency", group: field, name },
        );
      }
    } else if (RESOLUTION_FIELDS.includes(field)) {
      changes.push({ kind: "resolution", field });
    } else {
      changes.push({ kind: "other", field });
    }
  }
  return changes;
}

const RANK: Record<Scope, number> = {
  none: 0,
  changed: 1,
  packages: 2,
  all: 3,
};

/** Pure stage impact; package ownership and dependency closure belong to the caller. */
export function classifyValidationImpact(
  paths: readonly string[],
  { rootManifest }: { rootManifest?: RootManifestDelta } = {},
): ValidationImpact {
  const result: ValidationImpact = {
    format: { scope: "changed", reasons: [] },
    lint: { scope: "changed", reasons: [] },
    packages: { scope: "none", reasons: [] },
    native: { scope: "none", reasons: [] },
    packageInputs: [],
    lintPackageInputs: [],
    nonProse: false,
    typecheckScripts: false,
  };
  function widen(stage: ImpactStage, scope: Scope, reason: string) {
    if (RANK[scope] > RANK[result[stage].scope]) result[stage].scope = scope;
    if (!result[stage].reasons.includes(reason))
      result[stage].reasons.push(reason);
  }
  function resolution(reason: string) {
    for (const stage of ["format", "lint", "packages"] as const)
      widen(stage, "all", reason);
  }
  function manifestImpact() {
    for (const change of diffRootManifest(rootManifest)) {
      switch (change.kind) {
        case "unavailable":
          widen("packages", "all", change.reason);
          break;
        case "script": {
          const reason = `Root validation/build script ${change.name} changed.`;
          if (VALIDATION_SCRIPTS_FIX.includes(change.name)) {
            for (const stage of ["format", "lint", "native"] as const)
              widen(stage, "all", reason);
            if (change.name.startsWith("check"))
              widen("packages", "all", reason);
          } else if (BUILD_SCRIPTS.includes(change.name)) {
            widen("packages", "all", reason);
            if (change.name === "build:native") widen("native", "all", reason);
          }
          break;
        }
        case "dependency":
          widen("packages", "all", `Root manifest ${change.group} changed.`);
          if (FORMAT_TOOLS.has(change.name))
            widen(
              "format",
              "all",
              `Root formatter dependency ${change.name} changed.`,
            );
          if (LINT_TOOLS.has(change.name))
            widen(
              "lint",
              "all",
              `Root lint dependency ${change.name} changed.`,
            );
          break;
        case "resolution":
          resolution(
            `Tool/dependency-resolution uncertainty: root ${change.field} changed.`,
          );
          break;
        case "other": {
          const reason = `Root manifest ${change.field} changed.`;
          widen("packages", "all", reason);
          if (change.field === "type") widen("lint", "all", reason);
          break;
        }
      }
    }
  }

  for (const path of [...new Set(paths)].sort()) {
    if (isProse(path)) continue;
    result.nonProse = true;
    if (path.startsWith("scripts/") || SHARED_TSCONFIG.test(path))
      result.typecheckScripts = true;
    if (path === "package.json") {
      manifestImpact();
    } else if (["pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(path)) {
      resolution(`Tool/dependency-resolution uncertainty: ${path} changed.`);
    } else if (FORMATTER_CONFIG.test(path)) {
      widen(
        "format",
        "all",
        `Formatter/ignore configuration changed: ${path}.`,
      );
    } else if (ESLINT_CONFIG.test(path) || path === ".eslintignore") {
      widen("lint", "all", `ESLint configuration changed: ${path}.`);
    } else if (SHARED_TSCONFIG.test(path)) {
      widen("lint", "all", `Shared TypeScript configuration changed: ${path}.`);
      widen(
        "packages",
        "all",
        `Shared TypeScript configuration changed: ${path}.`,
      );
    } else if (NATIVE_TOOLCHAIN.test(path)) {
      widen("native", "all", `Native toolchain input changed: ${path}.`);
    } else if (
      /^packages\/[^/]+(?:\/|$)/.test(path) ||
      SPECIAL_OWNERS.has(path) ||
      path.startsWith(BRAND_ASSET_PREFIX)
    ) {
      result.packageInputs.push(path);
      widen("packages", "packages", "Package-owned inputs changed.");
      if (PACKAGE_TSCONFIG.test(path)) {
        result.lintPackageInputs.push(path);
        widen(
          "lint",
          "packages",
          `Package TypeScript configuration changed: ${path}.`,
        );
      }
      if (NATIVE_RUST_INPUT.test(path)) {
        widen("native", "all", `Native Rust input changed: ${path}.`);
      }
    } else if (isToolingPath(path) || path.startsWith(".github/")) {
      // Known validation tooling has no application package owner.
    } else {
      widen("packages", "all", `Unknown package ownership: ${path}.`);
    }
  }
  return result;
}
