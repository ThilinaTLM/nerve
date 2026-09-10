import {
  findDependencyCycles,
  resolveWorkbenchImport,
  workbenchBoundaryViolation,
} from "./workbench-boundaries.mjs";
import {
  importSpecifiers,
  sourceExtensions,
} from "./repository-source-inventory.mjs";

export function checkWorkbenchBoundaries({ files: trackedFiles, read }, fail) {
  checkWorkbenchFeatureBoundaries();
  checkWorkbenchLayerBoundaries();
  checkWorkbenchDependencyCycles();

  function checkWorkbenchFeatureBoundaries() {
    const appRoot = "packages/workbench-app/src/lib";
    const bannedTopLevel = [
      "core",
      "stores",
      "events",
      "audio",
      "hooks",
      "logging",
      "shortcuts",
      "utils",
    ];
    for (const directory of bannedTopLevel) {
      const prefix = `${appRoot}/${directory}/`;
      if (trackedFiles.some((file) => file.startsWith(prefix)))
        fail(
          prefix.slice(0, -1),
          "legacy workbench-app top-level directory remains",
        );
    }

    for (const retiredFeature of ["desktop", "workspace"]) {
      const prefix = `${appRoot}/features/${retiredFeature}/`;
      if (trackedFiles.some((file) => file.startsWith(prefix))) {
        fail(
          prefix.slice(0, -1),
          `${retiredFeature} is application/platform ownership, not a feature`,
        );
      }
    }

    for (const file of trackedFiles.filter(
      (path) =>
        path.startsWith("packages/workbench-app/src/") &&
        sourceExtensions.test(path),
    )) {
      const text = read(file);
      if (
        /\/features\/[^/]+\/index\.ts$/.test(file) &&
        /export\s+\{[^}]*\b[a-z][A-Za-z0-9]*State\b[^}]*\}\s+from/.test(text)
      )
        fail(file, "feature public APIs may not export mutable state objects");
      if (
        /\$lib\/(?:stores|events|audio|hooks|logging|shortcuts|utils)(?:\/|["'])/.test(
          text,
        )
      )
        fail(file, "legacy workbench app import remains");
      if (
        file.includes("/src/lib/app/shell/") &&
        /\$lib\/features\/[a-z0-9-]+\/(?:api|state|components|adapters|ui)\//.test(
          text,
        )
      )
        fail(
          file,
          "app shell must use feature barrels instead of deep feature state imports",
        );
    }
  }

  function checkWorkbenchLayerBoundaries() {
    for (const file of trackedFiles.filter(
      (path) =>
        path.startsWith("packages/workbench-app/src/lib/") &&
        sourceExtensions.test(path),
    )) {
      for (const specifier of importSpecifiers(read(file))) {
        const target = resolveWorkbenchImport(file, specifier);
        const violation = workbenchBoundaryViolation(file, target);
        if (violation) fail(file, `${violation}: ${specifier}`);
      }
    }
  }

  function checkWorkbenchDependencyCycles() {
    const sources = trackedFiles.filter(
      (path) =>
        path.startsWith("packages/workbench-app/src/lib/") &&
        sourceExtensions.test(path),
    );
    const sourceSet = new Set(sources);
    const graph = new Map(sources.map((file) => [file, new Set()]));

    for (const file of sources) {
      for (const specifier of importSpecifiers(read(file))) {
        const dependency = resolveTrackedWorkbenchImport(
          file,
          specifier,
          sourceSet,
        );
        if (dependency) graph.get(file).add(dependency);
      }
    }

    for (const cycle of findDependencyCycles(graph)) {
      const owners = new Set(cycle.map(workbenchOwner));
      if (owners.size < 2) continue;
      fail(
        cycle[0],
        `cross-owner dependency cycle: ${[...owners].sort().join(" <-> ")}`,
      );
    }
  }

  function resolveTrackedWorkbenchImport(file, specifier, sourceSet) {
    const base = resolveWorkbenchImport(file, specifier);
    if (!base) return undefined;
    const withoutJs = base.endsWith(".js") ? base.slice(0, -3) : base;
    const candidates = [
      base,
      withoutJs,
      `${withoutJs}.ts`,
      `${withoutJs}.svelte`,
      `${withoutJs}.svelte.ts`,
      `${withoutJs}/index.ts`,
    ];
    return candidates.find((candidate) => sourceSet.has(candidate));
  }

  function workbenchOwner(file) {
    const relative = file.slice("packages/workbench-app/src/lib/".length);
    const parts = relative.split("/");
    return parts[0] === "features" ? `features/${parts[1]}` : parts[0];
  }
}
