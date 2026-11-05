/**
 * Focused validation planner: maps the stage impact of a change set
 * (`impact/classify.ts`) to an ordered, inspectable plan of tool commands for
 * `fix:focused` and `check:focused`. Every stage is a pure function over the
 * shared selection context; scope and metadata errors are raised before any
 * command runs, so autofix never starts from a broken plan.
 */
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import {
  classifyChanges,
  classifyValidationImpact,
  type RootManifestDelta,
  type Scope,
  type ValidationImpact,
} from "../impact/classify.ts";
import { FORMAT_EXTENSIONS, LINT_EXTENSIONS } from "../impact/rules.ts";
import type { PackageManifest } from "../workspace/repo.ts";
import {
  readGitFile,
  readGitState,
  isBuildOutput,
  type GitState,
} from "../workspace/git.ts";
import {
  dependencyClosure,
  loadWorkspace,
  packageForPath,
  reverseDependencyClosure,
  validateWorkspace,
  type Workspace,
} from "../workspace/graph.ts";

export type ValidationOperation = "fix" | "check";
export type StageName =
  | "prepare"
  | "format"
  | "lint"
  | "policies"
  | "migrations"
  | "packages"
  | "native";
export const STAGE_NAMES: readonly StageName[] = [
  "prepare",
  "format",
  "lint",
  "policies",
  "migrations",
  "packages",
  "native",
];

export interface StagePlan {
  scope: Scope;
  targets: string[];
  reasons: string[];
}

export interface PlanStep {
  stage: StageName | "fallback";
  command: string;
  args: string[];
  reason: string;
}

export interface ValidationPlan {
  mode: "none" | "focused" | "mixed" | "full-fallback";
  operation: ValidationOperation;
  base: string;
  baseline?: string;
  reason?: string;
  stages: Record<StageName, StagePlan>;
  commands: PlanStep[];
}

const typescriptCheck =
  /^tsc -b(?: --pretty false)?(?: && pnpm check:native)?$/;
const nativeTypescriptCheck =
  /^(?:pnpm check:boundaries && )?tsc -b(?: --pretty false)?(?: && pnpm check:native)?$/;
const hasTypescriptCheck = (name: string, scripts: Record<string, string>) =>
  (name === "@nervekit/native" ? nativeTypescriptCheck : typescriptCheck).test(
    scripts.check ?? "",
  );
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const step = (
  stage: PlanStep["stage"],
  args: string[],
  reason: string,
): PlanStep => ({ stage, command: "pnpm", args, reason });
const emptyStage = (): StagePlan => ({
  scope: "none",
  targets: [],
  reasons: [],
});
const emptyStages = () =>
  Object.fromEntries(STAGE_NAMES.map((name) => [name, emptyStage()])) as Record<
    StageName,
    StagePlan
  >;

function stage(scope: Scope, targets: string[], reasons: string[]): StagePlan {
  return {
    scope: scope === "all" || targets.length ? scope : "none",
    targets,
    reasons,
  };
}

function fallbackPlan(
  operation: ValidationOperation,
  base: string,
  reason: string,
): ValidationPlan {
  return {
    mode: "full-fallback",
    operation,
    base,
    reason,
    stages: emptyStages(),
    commands: [step("fallback", ["run", operation], reason)],
  };
}

// The bounded batches are below Windows' command-line limit, including pnpm overhead.
function fileSteps(
  root: string,
  stageName: StageName,
  tool: string,
  options: string[],
  files: string[],
  reason: string,
): PlanStep[] {
  const commands: PlanStep[] = [];
  let batch: string[] = [];
  let length = 0;
  for (const file of files) {
    const target = resolve(root, file); // A filename cannot become an option.
    if (batch.length && length + target.length > 12000) {
      commands.push(
        step(stageName, ["exec", tool, ...options, ...batch], reason),
      );
      batch = [];
      length = 0;
    }
    batch.push(target);
    length += target.length + 3;
  }
  if (batch.length)
    commands.push(
      step(stageName, ["exec", tool, ...options, ...batch], reason),
    );
  return commands;
}

// ── Package selection ──────────────────────────────────────────────────────

function emittedProjects(
  root: string,
  names: Iterable<string>,
  workspace: Workspace,
): string[] {
  const projects: string[] = [];
  for (const name of sorted(names)) {
    const pkg = workspace.get(name)!;
    if (hasTypescriptCheck(name, pkg.scripts)) {
      const config = ts.readConfigFile(
        resolve(root, pkg.directory, "tsconfig.json"),
        ts.sys.readFile,
      );
      if (config.error)
        throw new Error(`Cannot read ${pkg.directory}/tsconfig.json`);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        resolve(root, pkg.directory),
      );
      if (
        parsed.errors.length ||
        !parsed.options.composite ||
        parsed.options.noEmit
      )
        throw new Error(`Unsupported declaration preparation for ${name}`);
      projects.push(`${pkg.directory}/tsconfig.json`);
    } else {
      const manifest = JSON.parse(
        readFileSync(resolve(root, pkg.directory, "package.json"), "utf8"),
      );
      if (JSON.stringify(manifest.exports ?? {}).includes("./dist/"))
        throw new Error(`Unsupported emitted API preparation for ${name}`);
    }
  }
  return projects;
}

function affectedPackages(
  paths: string[],
  workspace: Workspace,
): { all: boolean; names: Set<string> } {
  const impact = classifyChanges(
    paths.map((path) =>
      path.endsWith(".md") ? `${path}/runtime-asset` : path,
    ),
    workspace,
  );
  if (impact.full) return { all: true, names: new Set(workspace.keys()) };
  const names = reverseDependencyClosure(
    new Set(
      paths
        .map((path) => packageForPath(path, workspace))
        .filter((name): name is string => Boolean(name)),
    ),
    workspace,
  );
  for (const name of impact.packages) names.add(name);
  if (impact.website && workspace.has("@nervekit/website"))
    names.add("@nervekit/website");
  return { all: false, names: reverseDependencyClosure(names, workspace) };
}

// ── Stage selection (pure functions of the selection context) ───────────────

interface Selection {
  root: string;
  operation: ValidationOperation;
  state: GitState;
  impact: ValidationImpact;
  /** Changed, existing paths the stage targets are derived from. */
  paths: string[];
  inventory: string[];
  stages: Record<StageName, StagePlan>;
  workspace?: Workspace;
  packages: string[];
  lintTargets: string[];
}

function selectPackages(sel: Selection, preloaded?: Workspace) {
  const { operation, impact, root, state, paths, inventory } = sel;
  const existing = new Set(inventory);
  const changedLint = paths.filter(
    (path) => existing.has(path) && LINT_EXTENSIONS.has(extname(path).slice(1)),
  );
  const needWorkspace =
    (operation === "check" &&
      (impact.packages.scope !== "none" ||
        impact.lint.scope === "all" ||
        changedLint.some((path) => path.startsWith("packages/")))) ||
    impact.lint.scope === "packages";
  let lintPackages = new Set<string>();
  if (needWorkspace) {
    const workspace = preloaded ?? loadWorkspace(root);
    sel.workspace = workspace;
    validateWorkspace(root, state.files, workspace);
    if (operation === "check" && impact.packages.scope !== "none") {
      const selected =
        impact.packages.scope === "all"
          ? { all: true, names: new Set(workspace.keys()) }
          : affectedPackages(impact.packageInputs, workspace);
      sel.packages = sorted(selected.names);
      sel.stages.packages = stage(
        selected.all ? "all" : "packages",
        sel.packages,
        [
          ...impact.packages.reasons,
          ...(selected.all && impact.packages.scope !== "all"
            ? ["Package ownership is uncertain; check all packages."]
            : []),
        ],
      );
    }
    if (impact.lint.scope === "packages")
      lintPackages = affectedPackages(
        impact.lintPackageInputs,
        workspace,
      ).names;
  }
  return { changedLint, lintPackages };
}

function selectFormat(sel: Selection) {
  const { impact, paths, inventory } = sel;
  const existing = new Set(inventory);
  const changedFormat = paths.filter(
    (path) =>
      existing.has(path) &&
      FORMAT_EXTENSIONS.has(extname(path).slice(1)) &&
      path !== "pnpm-lock.yaml",
  );
  sel.stages.format = stage(
    impact.format.scope,
    impact.format.scope === "all" ? ["."] : changedFormat,
    impact.format.reasons,
  );
}

function selectLint(
  sel: Selection,
  changedLint: string[],
  lintPackages: Set<string>,
  lintFiles?: Set<string>,
) {
  const { impact, inventory, workspace } = sel;
  sel.lintTargets =
    impact.lint.scope === "all"
      ? ["."]
      : sorted([
          ...changedLint,
          ...inventory.filter(
            (path) =>
              lintPackages.size &&
              LINT_EXTENSIONS.has(extname(path).slice(1)) &&
              lintPackages.has(packageForPath(path, workspace!)!),
          ),
        ]).filter((path) => !lintFiles || lintFiles.has(path));
  sel.stages.lint = stage(
    impact.lint.scope,
    sel.lintTargets,
    impact.lint.reasons,
  );
}

function selectNative(sel: Selection) {
  const { impact, root } = sel;
  if (impact.native.scope === "none") return;
  const script = sel.operation === "fix" ? "fix:native" : "check:native";
  const native = JSON.parse(
    readFileSync(resolve(root, "packages/native/package.json"), "utf8"),
  );
  if (typeof native.scripts?.[script] !== "string")
    throw new Error(`No native ${script} script available`);
  sel.stages.native = stage("all", ["@nervekit/native"], impact.native.reasons);
}

// ── Command construction ────────────────────────────────────────────────────

function prepareCommands(sel: Selection): PlanStep[] {
  const { impact, root, stages, workspace } = sel;
  // Broad lint may need every emitted API without selecting all package check scripts.
  const lintOwners =
    impact.lint.scope === "all"
      ? new Set(workspace!.keys())
      : new Set(
          sel.lintTargets
            .map((path) => packageForPath(path, workspace!))
            .filter((name): name is string => Boolean(name)),
        );
  const prepare = emittedProjects(
    root,
    dependencyClosure(new Set([...sel.packages, ...lintOwners]), workspace!),
    workspace!,
  );
  if (!prepare.length) return [];
  stages.prepare = stage("packages", prepare, [
    "Prepare incremental declarations before typed lint and consumer checks.",
  ]);
  return [
    step(
      "prepare",
      ["exec", "tsc", "-b", "--pretty", "false", ...prepare],
      stages.prepare.reasons[0]!,
    ),
  ];
}

function formatCommands(
  sel: Selection,
  selection: StagePlan,
  after = false,
): PlanStep[] {
  const reason = after
    ? "format files lint autofix could modify"
    : "format selected files";
  const options = sel.operation === "check" ? ["--check"] : [];
  return selection.scope === "all"
    ? [step("format", ["exec", "oxfmt", ...options], reason)]
    : fileSteps(
        sel.root,
        "format",
        "oxfmt",
        ["--no-error-on-unmatched-pattern", ...options],
        selection.targets,
        reason,
      );
}

function lintCommands(sel: Selection): PlanStep[] {
  const options = sel.operation === "fix" ? ["--fix"] : [];
  return sel.stages.lint.scope === "all"
    ? [
        step(
          "lint",
          ["exec", "eslint", ".", ...options],
          "lint all applicable files",
        ),
      ]
    : fileSteps(
        sel.root,
        "lint",
        "eslint",
        options,
        sel.stages.lint.targets,
        "lint selected files",
      );
}

/** Lint autofix may touch files beyond the format selection; widen the closing format pass. */
function widenClosingFormat(sel: Selection) {
  const { stages } = sel;
  if (stages.lint.scope === "all") {
    stages.format = stage(
      "all",
      ["."],
      [
        ...stages.format.reasons,
        "Repository-wide lint autofix can modify previously unchanged files.",
      ],
    );
  } else if (
    stages.lint.scope === "packages" &&
    stages.format.scope !== "all"
  ) {
    stages.format = stage(
      "packages",
      sorted([
        ...stages.format.targets,
        ...stages.lint.targets.filter((path) =>
          FORMAT_EXTENSIONS.has(extname(path).slice(1)),
        ),
      ]),
      [
        ...stages.format.reasons,
        "Format files package-scoped lint autofix could modify.",
      ],
    );
  }
}

function checkOnlyCommands(sel: Selection): PlanStep[] {
  const { impact, root, stages, workspace, packages } = sel;
  const commands: PlanStep[] = [];
  if (impact.nonProse) {
    stages.policies = stage(
      "all",
      ["repository policies"],
      ["Global policy validation remains unchanged."],
    );
    stages.migrations = stage(
      "all",
      ["migration integrity"],
      ["Global migration validation remains unchanged."],
    );
    commands.push(
      step(
        "policies",
        ["exec", "tsx", "scripts/checks/check-package-boundaries.ts"],
        "global repository policies",
      ),
      step("migrations", ["migrations:check"], "global migration integrity"),
    );
    if (impact.typecheckScripts)
      commands.push(
        step(
          "policies",
          ["exec", "tsc", "-p", "scripts"],
          "type-check repository scripts",
        ),
      );
  }
  // The native package check is split into declaration preparation, a source
  // boundary policy, and Rust validation. Selecting one must not imply Cargo.
  if (packages.includes("@nervekit/native") || stages.native.scope !== "none") {
    const scripts: Record<string, string> =
      workspace?.get("@nervekit/native")?.scripts ??
      JSON.parse(
        readFileSync(resolve(root, "packages/native/package.json"), "utf8"),
      ).scripts;
    if (
      scripts.check?.startsWith("pnpm check:boundaries && ") &&
      typeof scripts["check:boundaries"] !== "string"
    )
      throw new Error("No native check:boundaries script available");
    if (typeof scripts["check:boundaries"] === "string")
      commands.push(
        step(
          "policies",
          ["--filter", "@nervekit/native", "run", "check:boundaries"],
          "check native internal source dependencies independently of Rust",
        ),
      );
  }
  for (const name of packages) {
    if (typeof workspace!.get(name)!.scripts.check !== "string")
      throw new Error(`No package check available for ${name}`);
  }
  // Broad scope lets pnpm select its whole workspace; native TS was checked by preparation.
  const regular = packages.filter((name) => name !== "@nervekit/native");
  if (stages.packages.scope === "all" || regular.length)
    commands.push(
      step(
        "packages",
        [
          "-r",
          ...(stages.packages.scope === "all"
            ? ["--filter", "!@nervekit/native"]
            : regular.flatMap((name) => ["--filter", name])),
          "run",
          "check",
        ],
        "check selected packages and downstream consumers",
      ),
    );
  if (
    packages.includes("@nervekit/native") &&
    !hasTypescriptCheck(
      "@nervekit/native",
      workspace!.get("@nervekit/native")!.scripts,
    )
  )
    throw new Error(
      "Unsupported native package check; cannot separate TypeScript from Rust",
    );
  if (stages.native.scope !== "none")
    commands.push(
      step(
        "native",
        ["--filter", "@nervekit/native", "run", "check:native"],
        "check selected native Rust inputs",
      ),
    );
  return commands;
}

export interface SelectionOptions {
  /** Lint targets the ESLint config does not ignore; omitted before it is consulted. */
  lintFiles?: Set<string>;
  rootManifest?: RootManifestDelta;
}

/** Construct every stage before execution; scope/metadata errors never trigger autofix. */
export function selectFocusedValidation(
  root: string,
  operation: ValidationOperation,
  state: GitState,
  workspace?: Workspace,
  { lintFiles, rootManifest }: SelectionOptions = {},
): ValidationPlan {
  if (!["fix", "check"].includes(operation))
    throw new Error(`Unknown validation operation: ${operation}`);
  const paths = state.paths.filter((path) => !isBuildOutput(path));
  const sel: Selection = {
    root,
    operation,
    state,
    impact: classifyValidationImpact(paths, { rootManifest }),
    paths,
    inventory: state.files.filter((path) => !isBuildOutput(path)),
    stages: emptyStages(),
    workspace,
    packages: [],
    lintTargets: [],
  };
  const { changedLint, lintPackages } = selectPackages(sel, workspace);
  selectLint(sel, changedLint, lintPackages, lintFiles);
  selectFormat(sel);
  selectNative(sel);

  const commands: PlanStep[] = [];
  if (operation === "check" && sel.workspace)
    commands.push(...prepareCommands(sel));
  if (operation === "fix" && sel.impact.native.scope !== "none")
    commands.push(
      step(
        "native",
        ["--filter", "@nervekit/native", "run", "fix:native"],
        "format selected native crate",
      ),
    );
  commands.push(...formatCommands(sel, sel.stages.format));
  commands.push(...lintCommands(sel));
  if (operation === "fix") {
    widenClosingFormat(sel);
    commands.push(...formatCommands(sel, sel.stages.format, true));
  } else {
    commands.push(...checkOnlyCommands(sel));
  }
  const { stages } = sel;
  const broad = [stages.format, stages.lint, stages.packages].some(
    (selection) => selection.scope === "all",
  );
  return {
    mode: commands.length ? (broad ? "mixed" : "focused") : "none",
    operation,
    base: state.base,
    baseline: state.baseline,
    stages,
    commands,
  };
}

// ── Root manifest comparison and planning entry ────────────────────────────

const MANIFEST_RECORDS = [
  "scripts",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function parseManifest(text: string, label: string): PackageManifest {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${label} package.json`);
  for (const field of MANIFEST_RECORDS) {
    const entries = value[field];
    if (
      entries !== undefined &&
      (!entries ||
        typeof entries !== "object" ||
        Array.isArray(entries) ||
        Object.values(entries).some((entry) => typeof entry !== "string"))
    ) {
      throw new Error(
        `Invalid ${label} package.json ${field}: expected string values`,
      );
    }
  }
  return value;
}

function rootManifestComparison(
  root: string,
  state: GitState,
): RootManifestDelta {
  let before: PackageManifest | null = null;
  let reason: string | undefined;
  try {
    const text = readGitFile(root, state.baseline, "package.json");
    if (text !== null) before = parseManifest(text, "baseline");
    else reason = "Root package.json did not exist at the baseline.";
  } catch (error) {
    reason = `Cannot compare baseline root manifest: ${(error as Error).message}`;
  }
  let after: PackageManifest | null = null;
  try {
    after = parseManifest(
      readFileSync(resolve(root, "package.json"), "utf8"),
      "current",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        `Cannot read current root package.json: ${(error as Error).message}`,
        { cause: error },
      );
    reason = "Current root package.json is missing.";
  }
  return { before, after, reason };
}

export async function planFocusedValidation(
  root: string,
  operation: ValidationOperation,
  base = "origin/main",
): Promise<ValidationPlan> {
  let state: GitState;
  try {
    state = readGitState(root, base);
  } catch (error) {
    return fallbackPlan(
      operation,
      base,
      `Cannot discover changed files: ${(error as Error).message}`,
    );
  }
  const rootManifest = state.paths.includes("package.json")
    ? rootManifestComparison(root, state)
    : undefined;
  const initial = selectFocusedValidation(root, operation, state, undefined, {
    rootManifest,
  });
  if (initial.stages.lint.scope === "none") return initial;
  const eslint = new ESLint({ cwd: root });
  if (initial.stages.lint.scope === "all") {
    // Force config loading during planning without changing the whole-repo target.
    await eslint.isPathIgnored(resolve(root, "__nerve_validation__.js"));
    return initial;
  }
  const lintFiles = new Set<string>();
  for (const file of initial.stages.lint.targets) {
    if (!(await eslint.isPathIgnored(resolve(root, file)))) lintFiles.add(file);
  }
  return selectFocusedValidation(root, operation, state, undefined, {
    rootManifest,
    lintFiles,
  });
}
