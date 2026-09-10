import { existsSync } from "node:fs";
import { join } from "node:path";
import { allowedNerveDependencies } from "./workspace-architecture.mjs";
import {
  importSpecifiers,
  resolvedImportPath,
  sourceExtensions,
} from "./repository-source-inventory.mjs";
const packageByDirectory = new Map(
  [...allowedNerveDependencies.keys()].map((name) => [
    name.slice("@nervekit/".length),
    name,
  ]),
);

export function checkPackageBoundaries(
  { repoRoot, files: trackedFiles, read },
  fail,
) {
  checkManifestGraph();
  checkSourceImports();

  function checkManifestGraph() {
    for (const [directory, expectedName] of packageByDirectory) {
      const manifestPath = join(
        repoRoot,
        "packages",
        directory,
        "package.json",
      );
      if (!existsSync(manifestPath)) {
        fail(
          `packages/${directory}/package.json`,
          `missing manifest for ${expectedName}`,
        );
        continue;
      }
      const manifest = JSON.parse(read(`packages/${directory}/package.json`));
      if (manifest.name !== expectedName)
        fail(
          `packages/${directory}/package.json`,
          `expected package name ${expectedName}, found ${manifest.name}`,
        );
      const allowed = allowedNerveDependencies.get(expectedName) ?? [];
      const declared = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      };
      for (const dependency of Object.keys(declared).sort()) {
        if (
          dependency.startsWith("@nervekit/") &&
          !allowed.includes(dependency)
        )
          fail(
            `packages/${directory}/package.json`,
            `${expectedName} may not depend on ${dependency}`,
          );
      }
    }

    for (const file of trackedFiles.filter((path) =>
      /^packages\/[^/]+\/package\.json$/.test(path),
    )) {
      const manifest = JSON.parse(read(file));
      if (!allowedNerveDependencies.has(manifest.name))
        fail(
          file,
          `unknown package boundary for ${manifest.name ?? "unnamed package"}`,
        );
    }
  }

  function checkSourceImports() {
    for (const file of trackedFiles.filter(
      (path) => path.startsWith("packages/") && sourceExtensions.test(path),
    )) {
      const packageName = packageNameForFile(file);
      if (!packageName) continue;
      const allowed = allowedNerveDependencies.get(packageName) ?? [];
      for (const specifier of importSpecifiers(read(file))) {
        if (specifier.startsWith("@nervekit/")) {
          const dependency = nervePackageName(specifier);
          if (dependency !== packageName && !allowed.includes(dependency))
            fail(file, `${packageName} may not import ${specifier}`);
        }
        if (packageName === "@nervekit/ui-kit" && specifier.startsWith("$lib"))
          fail(file, "ui-kit may not import app $lib modules");
        if (
          file.startsWith("packages/workbench-app/src/lib/presentation/") &&
          forbiddenPresentationImport(file, specifier)
        )
          fail(
            file,
            "presentation may not import app shells, feature state, or app core",
          );
        if (file.startsWith("packages/workbench-server/src/adapters/")) {
          const resolved = resolvedImportPath(file, specifier);
          if (resolved.endsWith("/app/runtime/runtime-lifecycle.js"))
            fail(
              file,
              "server adapters may not depend on process runtime lifecycle",
            );
          if (resolved.endsWith("/app/bootstrap/create-runtime-services.js"))
            fail(
              file,
              "server adapters may not import the bootstrap service aggregate",
            );
        }
        if (
          file === "packages/desktop-shell/src/app/desktop-runtime.ts" &&
          ["/platform/electron/electron-api.js", "/daemon/composition.js"].some(
            (suffix) => resolvedImportPath(file, specifier).endsWith(suffix),
          )
        )
          fail(
            file,
            "desktop runtime must receive Electron and daemon capabilities through injected ports",
          );
        if (
          file.startsWith(
            "packages/workbench-server/src/domains/runs/runtime/",
          ) &&
          forbiddenRunRuntimeImport(file, specifier)
        )
          fail(
            file,
            `run runtime may not import concrete server/runtime module ${specifier}`,
          );
        if (
          file === "packages/workbench-server/src/core/ports.ts" &&
          !specifier.startsWith("@nervekit/contracts")
        )
          fail(file, `server core ports may not import ${specifier}`);
        if (
          packageName === "@nervekit/contracts" &&
          forbiddenContractsImport(specifier)
        )
          fail(
            file,
            `contracts must remain transport/framework-neutral: ${specifier}`,
          );
      }
    }
  }

  function packageNameForFile(file) {
    const match = /^packages\/([^/]+)\//.exec(file);
    return match ? packageByDirectory.get(match[1]) : undefined;
  }

  function nervePackageName(specifier) {
    const match = /^(@nervekit\/[^/]+)/.exec(specifier);
    return match?.[1] ?? specifier;
  }

  function forbiddenRunRuntimeImport(file, specifier) {
    if (specifier.startsWith("@nervekit/contracts")) return false;
    if (specifier.startsWith("../../../core/ports/")) return false;
    if (!specifier.startsWith(".")) return true;
    return !resolvedImportPath(file, specifier).startsWith(
      "packages/workbench-server/src/domains/runs/runtime/",
    );
  }

  function forbiddenPresentationImport(file, specifier) {
    if (
      /^\$lib\/(?:app|application|domain|features|platform)(?:\/|$)/.test(
        specifier,
      )
    )
      return true;
    if (!specifier.startsWith(".")) return false;
    return !resolvedImportPath(file, specifier).startsWith(
      "packages/workbench-app/src/lib/presentation/",
    );
  }

  function forbiddenContractsImport(specifier) {
    return /^(?:@nervekit\/|hono(?:\/|$)|svelte(?:\/|$)|ws$|better-sqlite3$|sqlite3$)/.test(
      specifier,
    );
  }
}
