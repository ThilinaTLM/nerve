import { isDeepStrictEqual } from "node:util";

// Keep these aligned with ci-impact's explicit root asset/build ownership mapping.
const specialInputs = new Set([
  "scripts/build/copy-workbench-app-dist-to-workbench-server.mjs",
  "scripts/build/copy-skills-assets.mjs",
  "scripts/release/smoke-workbench-release.mjs",
  "scripts/release/smoke-electron-image-resize.mjs",
  "scripts/build/generate-brand-assets.mjs",
]);
const metadata = new Set([
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
const dependencyGroups = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);
// Installed Oxfmt/Svelte formatting and ESLint typed/Svelte configuration inputs.
const formatTools = new Set(["oxfmt", "svelte"]);
const lintTools = new Set([
  "eslint",
  "@eslint/js",
  "eslint-plugin-svelte",
  "globals",
  "typescript-eslint",
  "typescript",
  "svelte",
]);

export function isProse(path) {
  return (
    ["LICENSE", "NOTICE"].includes(path) ||
    (path.endsWith(".md") &&
      !path.startsWith("packages/website/") &&
      (!/^packages\/[^/]+\/(?:src|assets|test)\//.test(path) ||
        path.endsWith("/AGENTS.md")))
  );
}

/** Pure stage impact; package ownership and dependency closure belong to the caller. */
export function classifyValidationImpact(paths, { rootManifest } = {}) {
  const result = {
    format: { scope: "changed", reasons: [] },
    lint: { scope: "changed", reasons: [] },
    packages: { scope: "none", reasons: [] },
    native: { scope: "none", reasons: [] },
    packageInputs: [],
    lintPackageInputs: [],
    nonProse: false,
  };
  const rank = { none: 0, changed: 1, packages: 2, all: 3 };
  function widen(stage, scope, reason) {
    if (rank[scope] > rank[result[stage].scope]) result[stage].scope = scope;
    if (!result[stage].reasons.includes(reason))
      result[stage].reasons.push(reason);
  }
  function resolution(reason) {
    for (const stage of ["format", "lint", "packages"])
      widen(stage, "all", reason);
  }
  function manifestImpact() {
    const { before, after, reason } = rootManifest ?? {};
    if (after != null && (typeof after !== "object" || Array.isArray(after))) {
      throw new Error("Invalid current root package.json: expected an object.");
    }
    if (!before || !after) {
      widen(
        "packages",
        "all",
        reason ?? "Root manifest semantic comparison unavailable.",
      );
      return;
    }
    for (const field of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (isDeepStrictEqual(before[field], after[field]) || metadata.has(field))
        continue;
      const reason = `Root manifest ${field} changed.`;
      if (field === "scripts") {
        for (const name of new Set([
          ...Object.keys(before.scripts ?? {}),
          ...Object.keys(after.scripts ?? {}),
        ])) {
          if (isDeepStrictEqual(before.scripts?.[name], after.scripts?.[name]))
            continue;
          const scriptReason = `Root validation/build script ${name} changed.`;
          if (["fix", "fix:focused", "check", "check:focused"].includes(name)) {
            for (const stage of ["format", "lint", "native"])
              widen(stage, "all", scriptReason);
            if (name.startsWith("check"))
              widen("packages", "all", scriptReason);
          } else if (
            ["build", "build:native", "build:workbench-runtime"].includes(name)
          ) {
            widen("packages", "all", scriptReason);
            if (name === "build:native") widen("native", "all", scriptReason);
          }
        }
      } else if (dependencyGroups.has(field)) {
        widen("packages", "all", reason);
        for (const name of new Set([
          ...Object.keys(before[field] ?? {}),
          ...Object.keys(after[field] ?? {}),
        ])) {
          if (isDeepStrictEqual(before[field]?.[name], after[field]?.[name]))
            continue;
          if (formatTools.has(name))
            widen(
              "format",
              "all",
              `Root formatter dependency ${name} changed.`,
            );
          if (lintTools.has(name))
            widen("lint", "all", `Root lint dependency ${name} changed.`);
        }
      } else if (
        ["packageManager", "pnpm", "overrides", "resolutions"].includes(field)
      ) {
        resolution(
          `Tool/dependency-resolution uncertainty: root ${field} changed.`,
        );
      } else {
        widen("packages", "all", reason);
        if (field === "type") widen("lint", "all", reason);
      }
    }
  }

  for (const path of [...new Set(paths)].sort()) {
    if (isProse(path)) continue;
    result.nonProse = true;
    if (path === "package.json") {
      manifestImpact();
    } else if (["pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(path)) {
      resolution(`Tool/dependency-resolution uncertainty: ${path} changed.`);
    } else if (
      /(?:^|\/)(?:\.editorconfig|\.gitignore|\.oxfmtrc(?:\.[^/]+)?|\.oxfmtignore|\.prettierignore|\.prettierrc(?:\.[^/]+)?|prettier\.config\.[^/]+)$/.test(
        path,
      )
    ) {
      widen(
        "format",
        "all",
        `Formatter/ignore configuration changed: ${path}.`,
      );
    } else if (
      /(?:^|\/)eslint(?:\.[^/]+)?\.(?:js|mjs|cjs)$/.test(path) ||
      path === ".eslintignore"
    ) {
      widen("lint", "all", `ESLint configuration changed: ${path}.`);
    } else if (/^tsconfig(?:\.[^/]+)?\.json$/.test(path)) {
      widen("lint", "all", `Shared TypeScript configuration changed: ${path}.`);
      widen(
        "packages",
        "all",
        `Shared TypeScript configuration changed: ${path}.`,
      );
    } else if (
      /^(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.?rustfmt\.toml|\.cargo\/config(?:\.toml)?)$/.test(
        path,
      )
    ) {
      widen("native", "all", `Native toolchain input changed: ${path}.`);
    } else if (
      /^packages\/[^/]+(?:\/|$)/.test(path) ||
      specialInputs.has(path) ||
      path.startsWith("assets/brand/")
    ) {
      result.packageInputs.push(path);
      widen("packages", "packages", "Package-owned inputs changed.");
      if (/^packages\/[^/]+\/(?:.*\/)?tsconfig(?:\.[^/]+)?\.json$/.test(path)) {
        result.lintPackageInputs.push(path);
        widen(
          "lint",
          "packages",
          `Package TypeScript configuration changed: ${path}.`,
        );
      }
      if (
        /^packages\/native\/native\/(?:.*\.rs|(?:.*\/)?(?:Cargo\.(?:toml|lock)|rust-toolchain(?:\.toml)?|\.?rustfmt\.toml|\.cargo\/config(?:\.toml)?))$/.test(
          path,
        )
      ) {
        widen("native", "all", `Native Rust input changed: ${path}.`);
      }
    } else if (
      /^scripts\/(?:checks|testing|shared|storage-migrations)\//.test(path) ||
      path.startsWith(".github/workflows/")
    ) {
      // Known validation tooling has no application package owner.
    } else {
      widen("packages", "all", `Unknown package ownership: ${path}.`);
    }
  }
  return result;
}
