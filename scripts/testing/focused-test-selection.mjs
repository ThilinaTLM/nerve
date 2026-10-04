import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  classifyChanges,
  dependencyClosure,
  loadWorkspace,
  packageForPath,
  reverseDependencyClosure,
} from "./ci-impact.mjs";
import { createImportGraph, isSource } from "./test-import-graph.mjs";

const ignored =
  /(?:^|\/)(?:node_modules|\.git)\/|^target\/|^packages\/[^/]+\/(?:(?:dist|prebuilds|\.svelte-kit|\.astro|\.vite|release|build)\/|native\/target\/)/;
const sorted = (values) => [...values].sort();

export function readGitState(root, base = "origin/main") {
  function git(args) {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const revision = git([
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]).trim();
  const baseline = git(["merge-base", revision, "HEAD"]).trim();
  // --no-renames gives both old and new endpoints and avoids rename parsing ambiguity.
  const comparisons = [[baseline], ["--cached", baseline], []];
  const paths = comparisons.flatMap((comparison) =>
    git(["diff", "--name-only", "--no-renames", "-z", ...comparison, "--"])
      .split("\0")
      .filter(Boolean),
  );
  const deleted = new Set(
    comparisons.flatMap((comparison) =>
      git([
        "diff",
        "--name-only",
        "--no-renames",
        "--diff-filter=D",
        "-z",
        ...comparison,
        "--",
      ])
        .split("\0")
        .filter(Boolean),
    ),
  );
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  const files = sorted(
    new Set(
      [...git(["ls-files", "-z"]).split("\0"), ...untracked].filter(
        (path) =>
          path && !ignored.test(path) && existsSync(resolve(root, path)),
      ),
    ),
  );
  return {
    paths: sorted(new Set([...paths, ...untracked])),
    deleted,
    files,
    baseline,
    base,
  };
}

export function testRunner(name, pkg) {
  const frontend = ["@nervekit/workbench-app", "@nervekit/ui-kit"].includes(
    name,
  );
  const website = name === "@nervekit/website";
  const glob = website
    ? "scripts/**/*.test.mjs"
    : frontend
      ? "src/**/*.test.ts"
      : "test/**/*.test.ts";
  const command = website ? "node" : "tsx";
  const options =
    name === "@nervekit/workbench-server" ? ["--test-concurrency=1"] : [];
  const expected = `${command} --test${options.length ? ` ${options.join(" ")}` : ""} "${glob}"${name === "@nervekit/native" ? " && pnpm test:native" : ""}`;
  return { command, options, glob, supported: pkg.scripts.test === expected };
}

function testFiles(files, pkg, runner) {
  const [directory] = runner.glob.split("/**");
  const suffix = runner.glob.endsWith(".mjs") ? ".test.mjs" : ".test.ts";
  return files.filter(
    (path) =>
      path.startsWith(`${pkg.directory}/${directory}/`) &&
      path.endsWith(suffix),
  );
}

export function selectFocusedTests(
  root,
  state,
  workspace = loadWorkspace(root),
) {
  const full = (reason) => ({
    mode: "full",
    reason,
    base: state.base,
    baseline: state.baseline,
    packages: [],
    commands: [{ command: "pnpm", args: ["run", "test:full"], reason }],
  });
  // Skill prose is executable runtime data; the CI classifier's general Markdown skip
  // is not sufficient for a local test selector.
  const paths = state.paths.filter((path) => !ignored.test(path));
  const runtimeMarkdown = paths.filter(
    (path) =>
      /^packages\/[^/]+\/(?:src|assets|test)\//.test(path) &&
      path.endsWith(".md") &&
      !path.endsWith("/AGENTS.md"),
  );
  const impact = classifyChanges(
    [
      ...paths,
      ...runtimeMarkdown.map(
        (path) =>
          `${workspace.get(packageForPath(path, workspace))?.directory}/runtime-asset`,
      ),
    ],
    workspace,
  );
  if (impact.full)
    return full(
      "global configuration, test infrastructure, or unknown ownership changed",
    );
  const affected = new Set(impact.packages);
  if (impact.website) affected.add("@nervekit/website");
  // The CI output deliberately lists core packages only. New workspace packages
  // must still participate in local selection rather than disappear silently.
  const direct = paths
    .filter((path) => !path.endsWith(".md") || runtimeMarkdown.includes(path))
    .map((path) => packageForPath(path, workspace))
    .filter(Boolean);
  for (const name of reverseDependencyClosure(new Set(direct), workspace))
    affected.add(name);
  if (!affected.size)
    return {
      mode: "none",
      reason: "No executable changes require tests.",
      base: state.base,
      baseline: state.baseline,
      packages: [],
      commands: [],
    };
  try {
    const graph = createImportGraph(root, state.files, workspace);
    const fallback = new Map();
    for (const path of paths) {
      if (!packageForPath(path, workspace) && !path.endsWith(".md")) {
        for (const name of affected)
          fallback.set(name, new Set([`${path}: external owned input`]));
      }
    }
    const relevant = paths.filter((path) => {
      const owner = packageForPath(path, workspace);
      return (
        owner &&
        affected.has(owner) &&
        (!path.endsWith(".md") || runtimeMarkdown.includes(path))
      );
    });
    function expand(path, reason) {
      const owner = packageForPath(path, workspace);
      for (const name of reverseDependencyClosure(
        new Set([owner]),
        workspace,
      )) {
        if (affected.has(name)) {
          const reasons = fallback.get(name) ?? new Set();
          reasons.add(`${path}: ${reason}`);
          fallback.set(name, reasons);
        }
      }
    }
    for (const path of relevant) {
      const pkg = workspace.get(packageForPath(path, workspace));
      const local = path.slice(pkg.directory.length + 1);
      if (state.deleted.has(path)) expand(path, "deleted or renamed file");
      else if (
        !isSource(path) ||
        /(?:^|\/)(?:fixtures?|assets?|native)\//.test(local) ||
        /(?:^|\/)(?:[^/]*config\.[^/]+|package\.json)$/.test(local)
      )
        expand(path, "configuration, fixture, asset, or unsupported source");
      else if (
        !local.startsWith("src/") &&
        !local.startsWith("test/") &&
        !local.startsWith("scripts/")
      )
        expand(path, "unclassified package input");
    }
    const packages = [];
    const matched = new Set();
    for (const name of sorted(affected)) {
      const pkg = workspace.get(name);
      if (!pkg) return full(`Unknown affected package: ${name}`);
      if (!pkg.scripts.test) continue;
      const runner = testRunner(name, pkg);
      if (!runner.supported) return full(`Unrecognized test runner: ${name}`);
      const inventory = testFiles(state.files, pkg, runner);
      const tests = [];
      for (const file of inventory) {
        const trace = graph.trace(file);
        const dependencies = relevant.filter((path) => trace.chains.has(path));
        for (const path of dependencies) matched.add(path);
        const reasons = dependencies.map((path) =>
          path === file
            ? "changed test"
            : `imports ${path}: ${trace.chains.get(path).join(" -> ")}`,
        );
        if (trace.warnings.length)
          reasons.push(
            ...trace.warnings.map((warning) => `opaque dependency: ${warning}`),
          );
        if (reasons.length) tests.push({ file, reasons });
      }
      packages.push({
        name,
        directory: pkg.directory,
        runner,
        inventory,
        tests,
      });
    }
    for (const path of relevant) {
      if (
        isSource(path) &&
        !matched.has(path) &&
        !fallback.has(packageForPath(path, workspace))
      )
        expand(path, "no test dependency could be established");
    }
    for (const pkg of packages) {
      pkg.fallback = sorted(fallback.get(pkg.name) ?? []);
      // Native's script owns Cargo coverage even for a graph-selected TS wrapper.
      if (pkg.name === "@nervekit/native" && pkg.tests.length)
        pkg.fallback.push(
          "native package requires its TypeScript and Rust suite",
        );
      if (pkg.fallback.length)
        pkg.tests = pkg.inventory.map((file) => ({
          file,
          reasons: pkg.fallback,
        }));
    }
    const selected = packages.filter(
      (pkg) => pkg.fallback.length || pkg.tests.length,
    );
    const required = dependencyClosure(
      new Set(selected.map((pkg) => pkg.name)),
      workspace,
    );
    const builds = [];
    for (const name of sorted(required)) {
      const pkg = workspace.get(name);
      const file = resolve(root, pkg.directory, "tsconfig.json");
      if (!existsSync(file)) continue;
      const config = ts.readConfigFile(file, ts.sys.readFile);
      if (config.error)
        return full(`Cannot determine build prerequisites for ${name}`);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        resolve(root, pkg.directory),
      );
      if (parsed.errors.some((error) => error.code !== 18003))
        return full(`Cannot determine build prerequisites for ${name}`);
      if (!parsed.options.noEmit && parsed.options.outDir && pkg.scripts.build)
        builds.push(name);
    }
    const commands = [];
    if (required.has("@nervekit/native"))
      commands.push({
        command: "pnpm",
        args: ["build:native"],
        reason: "selected package runtime requires native",
      });
    if (builds.length)
      commands.push({
        command: "pnpm",
        args: [
          ...builds.flatMap((name) => ["--filter", name]),
          "--if-present",
          "build",
        ],
        reason: "prepare emitted workspace APIs",
      });
    if (selected.length)
      commands.push({
        command: "node",
        args: ["--test", "scripts/**/*.test.mjs"],
        reason: "root script baseline (non-import dependencies)",
      });
    for (const pkg of selected) {
      const manifest = workspace.get(pkg.name);
      if (pkg.fallback.length) {
        commands.push({
          command: "pnpm",
          args: ["--filter", pkg.name, "test"],
          reason: pkg.fallback.join("; "),
        });
      } else {
        if (manifest.scripts.pretest)
          commands.push({
            command: "pnpm",
            args: ["--filter", pkg.name, "run", "pretest"],
            reason: "package pretest lifecycle",
          });
        commands.push({
          command: "pnpm",
          args: [
            "--filter",
            pkg.name,
            "exec",
            pkg.runner.command,
            "--test",
            ...pkg.runner.options,
            ...pkg.tests.map((test) =>
              test.file.slice(pkg.directory.length + 1),
            ),
          ],
          reason: "selected import-related or opaque tests",
        });
        if (manifest.scripts.posttest)
          commands.push({
            command: "pnpm",
            args: ["--filter", pkg.name, "run", "posttest"],
            reason: "package posttest lifecycle",
          });
      }
    }
    return {
      mode: selected.length ? "focused" : "none",
      base: state.base,
      baseline: state.baseline,
      packages: selected,
      commands,
      selected: selected.reduce((sum, pkg) => sum + pkg.tests.length, 0),
      total: packages.reduce((sum, pkg) => sum + pkg.inventory.length, 0),
    };
  } catch (error) {
    return full(`Cannot establish test impact: ${error.message}`);
  }
}

export function planFocusedTests(root, base = "origin/main") {
  try {
    return selectFocusedTests(root, readGitState(root, base));
  } catch (error) {
    return {
      mode: "full",
      base,
      reason: `Cannot discover changes: ${error.message}`,
      packages: [],
      commands: [
        {
          command: "pnpm",
          args: ["run", "test:full"],
          reason: "Git discovery unavailable",
        },
      ],
    };
  }
}
