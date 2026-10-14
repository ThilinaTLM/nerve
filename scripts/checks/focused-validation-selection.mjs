import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { isIgnoredPath, readGitState } from "../shared/git-changes.mjs";
import {
  classifyChanges,
  dependencyClosure,
  loadWorkspace,
  packageForPath,
  reverseDependencyClosure,
} from "../testing/ci-impact.mjs";

// Oxfmt 0.58's supported extensions. Astro and Rust are not formatter inputs.
const formatExtensions = new Set(
  "js jsx mjs cjs ts tsx mts cts json jsonc json5 yaml yml toml html htm vue svelte css scss less md markdown mdx graphql gql hbs handlebars".split(
    " ",
  ),
);
const lintExtensions = new Set(
  "js jsx mjs cjs ts tsx mts cts svelte".split(" "),
);
const sorted = (values) => [...new Set(values)].sort();
const step = (args, reason) => ({ command: "pnpm", args, reason });
const typescriptCheck =
  /^tsc -b(?: --pretty false)?(?: && pnpm check:native)?$/;

function fullPlan(operation, state, reason) {
  return {
    mode: "full",
    operation,
    base: state.base,
    baseline: state.baseline,
    reason,
    files: { format: [], lint: [] },
    packages: [],
    commands: [step(["run", operation], reason)],
  };
}

function isProse(path) {
  return (
    path.endsWith(".md") &&
    !path.startsWith("packages/website/") &&
    (!/^packages\/[^/]+\/(?:src|assets|test)\//.test(path) ||
      path.endsWith("/AGENTS.md"))
  );
}

function isGlobalValidationInput(path) {
  return (
    /(?:^|\/)(?:\.oxfmtrc(?:\.[^/]+)?|\.prettierignore|\.prettierrc(?:\.[^/]+)?|prettier\.config\.[^/]+)$/.test(
      path,
    ) || path === ".gitignore"
  );
}

function requiresRust(paths) {
  return paths.some((path) =>
    /^packages\/native\/native\/(?:.*\.rs|(?:.*\/)?(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.?rustfmt\.toml|\.cargo\/config(?:\.toml)?))$/.test(
      path,
    ),
  );
}

// Stay below Windows' command-line limit, even after pnpm adds its own arguments.
function fileSteps(root, tool, options, files, reason) {
  const commands = [];
  let batch = [];
  let length = 0;
  for (const file of files) {
    // Absolute paths cannot be mistaken for options. Tools resolve their own ignores.
    const target = resolve(root, file);
    if (batch.length && length + target.length > 12000) {
      commands.push(step(["exec", tool, ...options, ...batch], reason));
      batch = [];
      length = 0;
    }
    batch.push(target);
    length += target.length + 3;
  }
  if (batch.length)
    commands.push(step(["exec", tool, ...options, ...batch], reason));
  return commands;
}

function emittedProjects(root, names, workspace) {
  const projects = [];
  for (const name of sorted(names)) {
    const pkg = workspace.get(name);
    if (typescriptCheck.test(pkg.scripts.check ?? "")) {
      const configPath = resolve(root, pkg.directory, "tsconfig.json");
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
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
      ) {
        throw new Error(`Unsupported declaration preparation for ${name}`);
      }
      projects.push(`${pkg.directory}/tsconfig.json`);
    } else {
      const manifest = JSON.parse(
        readFileSync(resolve(root, pkg.directory, "package.json"), "utf8"),
      );
      if (JSON.stringify(manifest.exports ?? {}).includes("./dist/")) {
        throw new Error(`Unsupported emitted API preparation for ${name}`);
      }
    }
  }
  return projects;
}

/** Build a deterministic plan; lintFiles can be filtered through ESLint's own config. */
export function selectFocusedValidation(
  root,
  operation,
  state,
  workspace = loadWorkspace(root),
  { lintFiles } = {},
) {
  if (!["fix", "check"].includes(operation))
    throw new Error(`Unknown validation operation: ${operation}`);
  const full = (reason) => fullPlan(operation, state, reason);
  try {
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
          ) {
            throw new Error(`Unknown workspace dependency ${name} in ${file}`);
          }
        }
      }
      names.add(manifest.name);
    }
    if (names.size !== workspace.size)
      throw new Error("Workspace metadata does not match the Git inventory");
    const paths = state.paths.filter((path) => !isIgnoredPath(path));
    if (paths.some(isGlobalValidationInput))
      return full("Shared formatter/ignore configuration changed.");
    const inputs = paths.filter((path) => !isProse(path));
    // The CI classifier skips Markdown except website content. Runtime Markdown is owned input.
    const impact = classifyChanges(
      inputs.map((path) =>
        path.endsWith(".md") ? `${path}/runtime-asset` : path,
      ),
      workspace,
    );
    if (impact.full)
      return full(
        "Global configuration, validation infrastructure, or unknown ownership changed.",
      );
    const direct = new Set(
      inputs.map((path) => packageForPath(path, workspace)).filter(Boolean),
    );
    const affected = reverseDependencyClosure(direct, workspace);
    for (const name of impact.packages) affected.add(name);
    if (impact.website && workspace.has("@nervekit/website"))
      affected.add("@nervekit/website");
    // Include dependents of special root-input owners too, including new workspace packages.
    const packages = sorted(reverseDependencyClosure(affected, workspace));
    const existing = new Set(state.files);
    const files = {
      format: paths.filter(
        (path) =>
          existing.has(path) &&
          formatExtensions.has(extname(path).slice(1)) &&
          path !== "pnpm-lock.yaml",
      ),
      lint: paths.filter(
        (path) =>
          existing.has(path) &&
          lintExtensions.has(extname(path).slice(1)) &&
          (!lintFiles || lintFiles.has(path)),
      ),
    };
    const commands = [];
    const rust = requiresRust(inputs);
    const format = (options) =>
      fileSteps(
        root,
        "oxfmt",
        ["--no-error-on-unmatched-pattern", ...options],
        files.format,
        "format changed files",
      );
    const lint = (options) =>
      fileSteps(root, "eslint", options, files.lint, "lint changed files");
    if (operation === "fix") {
      if (rust)
        commands.push(
          step(
            ["--filter", "@nervekit/native", "run", "fix:native"],
            "format changed native crate",
          ),
        );
      commands.push(...format([]), ...lint(["--fix"]), ...format([]));
    } else {
      for (const name of packages) {
        if (!workspace.get(name).scripts.check)
          return full(`No package check available for ${name}.`);
      }
      if (packages.length) {
        const projects = emittedProjects(
          root,
          dependencyClosure(new Set(packages), workspace),
          workspace,
        );
        if (projects.length)
          commands.push(
            step(
              ["exec", "tsc", "-b", "--pretty", "false", ...projects],
              "prepare incremental workspace declarations before typed lint and package checks",
            ),
          );
      }
      commands.push(...format(["--check"]), ...lint([]));
      if (inputs.length) {
        commands.push({
          command: "node",
          args: ["scripts/checks/check-package-boundaries.mjs"],
          reason: "global repository policies",
        });
        commands.push(step(["migrations:check"], "global migration integrity"));
      }
      const regular = packages.filter((name) => name !== "@nervekit/native");
      if (regular.length)
        commands.push(
          step(
            [
              "-r",
              ...regular.flatMap((name) => ["--filter", name]),
              "run",
              "check",
            ],
            "check affected packages and downstream consumers",
          ),
        );
      // Native's package script combines TS and Rust. Declarations above check TS without Clippy.
      if (
        packages.includes("@nervekit/native") &&
        !typescriptCheck.test(workspace.get("@nervekit/native").scripts.check)
      ) {
        return full("Unsupported native package check.");
      }
      if (rust) {
        if (!workspace.get("@nervekit/native")?.scripts["check:native"])
          return full("No native Rust check available.");
        commands.push(
          step(
            ["--filter", "@nervekit/native", "run", "check:native"],
            "check changed native Rust inputs",
          ),
        );
      }
    }
    return {
      mode: commands.length ? "focused" : "none",
      operation,
      base: state.base,
      baseline: state.baseline,
      reason: inputs.length
        ? undefined
        : "No executable inputs require package checks.",
      files,
      packages,
      commands,
    };
  } catch (error) {
    return full(`Cannot establish validation scope: ${error.message}`);
  }
}

export async function planFocusedValidation(
  root,
  operation,
  base = "origin/main",
) {
  let state;
  try {
    state = readGitState(root, base);
    const workspace = loadWorkspace(root);
    // Global plans don't need to resolve ESLint configuration or load project services.
    const initial = selectFocusedValidation(root, operation, state, workspace);
    if (initial.mode === "full" || !initial.files.lint.length) return initial;
    const eslint = new ESLint({ cwd: root });
    const lintFiles = new Set();
    for (const file of initial.files.lint) {
      if (!(await eslint.isPathIgnored(resolve(root, file))))
        lintFiles.add(file);
    }
    return selectFocusedValidation(root, operation, state, workspace, {
      lintFiles,
    });
  } catch (error) {
    return fullPlan(
      operation,
      state ?? { base },
      `Cannot discover validation scope: ${error.message}`,
    );
  }
}
