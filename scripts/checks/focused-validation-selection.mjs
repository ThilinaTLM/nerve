import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import {
  isIgnoredPath,
  readGitFile,
  readGitState,
} from "../shared/git-changes.mjs";
import {
  classifyChanges,
  dependencyClosure,
  loadWorkspace,
  packageForPath,
  reverseDependencyClosure,
} from "../testing/ci-impact.mjs";
import { classifyValidationImpact } from "./validation-impact.mjs";

// Oxfmt 0.58 supports these extensions, but not Astro or Rust.
const formatExtensions = new Set(
  "js jsx mjs cjs ts tsx mts cts json jsonc json5 yaml yml toml html htm vue svelte css scss less md markdown mdx graphql gql hbs handlebars".split(
    " ",
  ),
);
const lintExtensions = new Set(
  "js jsx mjs cjs ts tsx mts cts svelte".split(" "),
);
const typescriptCheck =
  /^tsc -b(?: --pretty false)?(?: && pnpm check:native)?$/;
const sorted = (values) => [...new Set(values)].sort();
const step = (stage, args, reason) => ({
  stage,
  command: "pnpm",
  args,
  reason,
});
const emptyStage = () => ({ scope: "none", targets: [], reasons: [] });
const emptyStages = () =>
  Object.fromEntries(
    [
      "prepare",
      "format",
      "lint",
      "policies",
      "migrations",
      "packages",
      "native",
    ].map((name) => [name, emptyStage()]),
  );

function fallbackPlan(operation, base, reason) {
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
function fileSteps(root, stage, tool, options, files, reason) {
  const commands = [];
  let batch = [];
  let length = 0;
  for (const file of files) {
    const target = resolve(root, file); // A filename cannot become an option.
    if (batch.length && length + target.length > 12000) {
      commands.push(step(stage, ["exec", tool, ...options, ...batch], reason));
      batch = [];
      length = 0;
    }
    batch.push(target);
    length += target.length + 3;
  }
  if (batch.length)
    commands.push(step(stage, ["exec", tool, ...options, ...batch], reason));
  return commands;
}

function validateWorkspace(root, state, workspace) {
  const names = new Set();
  for (const file of state.files.filter((path) =>
    /^packages\/[^/]+\/package\.json$/.test(path),
  )) {
    const manifest = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    if (
      typeof manifest.name !== "string" ||
      names.has(manifest.name) ||
      workspace.get(manifest.name)?.directory !==
        file.slice(0, -"/package.json".length)
    ) {
      throw new Error(`Invalid or duplicate workspace name in ${file}`);
    }
    for (const group of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ]) {
      for (const [name, version] of Object.entries(group ?? {})) {
        if (
          typeof version === "string" &&
          version.startsWith("workspace:") &&
          !workspace.has(name)
        )
          throw new Error(`Unknown workspace dependency ${name} in ${file}`);
      }
    }
    names.add(manifest.name);
  }
  if (names.size !== workspace.size)
    throw new Error("Workspace metadata does not match the Git inventory");
}

function emittedProjects(root, names, workspace) {
  const projects = [];
  for (const name of sorted(names)) {
    const pkg = workspace.get(name);
    if (typescriptCheck.test(pkg.scripts.check ?? "")) {
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

function affectedPackages(paths, workspace) {
  const impact = classifyChanges(
    paths.map((path) =>
      path.endsWith(".md") ? `${path}/runtime-asset` : path,
    ),
    workspace,
  );
  if (impact.full) return { all: true, names: new Set(workspace.keys()) };
  const names = reverseDependencyClosure(
    new Set(
      paths.map((path) => packageForPath(path, workspace)).filter(Boolean),
    ),
    workspace,
  );
  for (const name of impact.packages) names.add(name);
  if (impact.website && workspace.has("@nervekit/website"))
    names.add("@nervekit/website");
  return { all: false, names: reverseDependencyClosure(names, workspace) };
}

function stage(scope, targets, reasons) {
  return {
    scope: scope === "all" || targets.length ? scope : "none",
    targets,
    reasons,
  };
}

/** Construct every stage before execution; scope/metadata errors never trigger autofix. */
export function selectFocusedValidation(
  root,
  operation,
  state,
  workspace,
  { lintFiles, rootManifest } = {},
) {
  if (!["fix", "check"].includes(operation))
    throw new Error(`Unknown validation operation: ${operation}`);
  const paths = state.paths.filter((path) => !isIgnoredPath(path));
  const inventory = state.files.filter((path) => !isIgnoredPath(path));
  const impact = classifyValidationImpact(paths, { rootManifest });
  const stages = emptyStages();
  const existing = new Set(inventory);
  const changedFormat = paths.filter(
    (path) =>
      existing.has(path) &&
      formatExtensions.has(extname(path).slice(1)) &&
      path !== "pnpm-lock.yaml",
  );
  const changedLint = paths.filter(
    (path) => existing.has(path) && lintExtensions.has(extname(path).slice(1)),
  );
  let packages = [];
  let lintPackages = new Set();
  const needWorkspace =
    (operation === "check" &&
      (impact.packages.scope !== "none" ||
        impact.lint.scope === "all" ||
        changedLint.some((path) => path.startsWith("packages/")))) ||
    impact.lint.scope === "packages";
  if (needWorkspace) {
    workspace ??= loadWorkspace(root);
    validateWorkspace(root, state, workspace);
    if (operation === "check" && impact.packages.scope !== "none") {
      const selected =
        impact.packages.scope === "all"
          ? { all: true, names: new Set(workspace.keys()) }
          : affectedPackages(impact.packageInputs, workspace);
      packages = sorted(selected.names);
      stages.packages = stage(selected.all ? "all" : "packages", packages, [
        ...impact.packages.reasons,
        ...(selected.all && impact.packages.scope !== "all"
          ? ["Package ownership is uncertain; check all packages."]
          : []),
      ]);
    }
    if (impact.lint.scope === "packages") {
      lintPackages = affectedPackages(
        impact.lintPackageInputs,
        workspace,
      ).names;
    }
  }
  const lintTargets =
    impact.lint.scope === "all"
      ? ["."]
      : sorted([
          ...changedLint,
          ...inventory.filter(
            (path) =>
              lintPackages.size &&
              lintExtensions.has(extname(path).slice(1)) &&
              lintPackages.has(packageForPath(path, workspace)),
          ),
        ]).filter((path) => !lintFiles || lintFiles.has(path));
  stages.format = stage(
    impact.format.scope,
    impact.format.scope === "all" ? ["."] : changedFormat,
    impact.format.reasons,
  );
  stages.lint = stage(impact.lint.scope, lintTargets, impact.lint.reasons);
  const commands = [];
  if (operation === "check" && workspace) {
    // Broad lint may need every emitted API without selecting all package check scripts.
    const lintOwners =
      impact.lint.scope === "all"
        ? new Set(workspace.keys())
        : new Set(
            lintTargets
              .map((path) => packageForPath(path, workspace))
              .filter(Boolean),
          );
    const prepare = emittedProjects(
      root,
      dependencyClosure(new Set([...packages, ...lintOwners]), workspace),
      workspace,
    );
    if (prepare.length) {
      stages.prepare = stage("packages", prepare, [
        "Prepare incremental declarations before typed lint and consumer checks.",
      ]);
      commands.push(
        step(
          "prepare",
          ["exec", "tsc", "-b", "--pretty", "false", ...prepare],
          stages.prepare.reasons[0],
        ),
      );
    }
  }
  const formatCommands = (selection, after = false) => {
    const reason = after
      ? "format files lint autofix could modify"
      : "format selected files";
    const options = operation === "check" ? ["--check"] : [];
    return selection.scope === "all"
      ? [step("format", ["exec", "oxfmt", ...options], reason)]
      : fileSteps(
          root,
          "format",
          "oxfmt",
          ["--no-error-on-unmatched-pattern", ...options],
          selection.targets,
          reason,
        );
  };
  const nativeScript = operation === "fix" ? "fix:native" : "check:native";
  if (impact.native.scope !== "none") {
    const native = JSON.parse(
      readFileSync(resolve(root, "packages/native/package.json"), "utf8"),
    );
    if (typeof native.scripts?.[nativeScript] !== "string")
      throw new Error(`No native ${nativeScript} script available`);
    stages.native = stage("all", ["@nervekit/native"], impact.native.reasons);
    if (operation === "fix")
      commands.push(
        step(
          "native",
          ["--filter", "@nervekit/native", "run", nativeScript],
          "format selected native crate",
        ),
      );
  }
  commands.push(...formatCommands(stages.format));
  const lintOptions = operation === "fix" ? ["--fix"] : [];
  commands.push(
    ...(stages.lint.scope === "all"
      ? [
          step(
            "lint",
            ["exec", "eslint", ".", ...lintOptions],
            "lint all applicable files",
          ),
        ]
      : fileSteps(
          root,
          "lint",
          "eslint",
          lintOptions,
          stages.lint.targets,
          "lint selected files",
        )),
  );
  if (operation === "fix") {
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
            formatExtensions.has(extname(path).slice(1)),
          ),
        ]),
        [
          ...stages.format.reasons,
          "Format files package-scoped lint autofix could modify.",
        ],
      );
    }
    commands.push(...formatCommands(stages.format, true));
  } else {
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
        {
          stage: "policies",
          command: "node",
          args: ["scripts/checks/check-package-boundaries.mjs"],
          reason: "global repository policies",
        },
        step("migrations", ["migrations:check"], "global migration integrity"),
      );
    }
    for (const name of packages) {
      if (typeof workspace.get(name).scripts.check !== "string")
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
      !typescriptCheck.test(workspace.get("@nervekit/native").scripts.check)
    )
      throw new Error(
        "Unsupported native package check; cannot separate TypeScript from Rust",
      );
    if (stages.native.scope !== "none")
      commands.push(
        step(
          "native",
          ["--filter", "@nervekit/native", "run", nativeScript],
          "check selected native Rust inputs",
        ),
      );
  }
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

function parseManifest(text, label) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${label} package.json`);
  for (const field of [
    "scripts",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
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

function rootManifestComparison(root, state) {
  let before = null;
  let reason;
  try {
    const text = readGitFile(root, state.baseline, "package.json");
    if (text !== null) before = parseManifest(text, "baseline");
    else reason = "Root package.json did not exist at the baseline.";
  } catch (error) {
    reason = `Cannot compare baseline root manifest: ${error.message}`;
  }
  let after = null;
  try {
    after = parseManifest(
      readFileSync(resolve(root, "package.json"), "utf8"),
      "current",
    );
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        `Cannot read current root package.json: ${error.message}`,
        { cause: error },
      );
    reason = "Current root package.json is missing.";
  }
  return { before, after, reason };
}

export async function planFocusedValidation(
  root,
  operation,
  base = "origin/main",
) {
  let state;
  try {
    state = readGitState(root, base);
  } catch (error) {
    return fallbackPlan(
      operation,
      base,
      `Cannot discover changed files: ${error.message}`,
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
  const lintFiles = new Set();
  for (const file of initial.stages.lint.targets) {
    if (!(await eslint.isPathIgnored(resolve(root, file)))) lintFiles.add(file);
  }
  return selectFocusedValidation(root, operation, state, undefined, {
    rootManifest,
    lintFiles,
  });
}
