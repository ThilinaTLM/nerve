import { existsSync } from "node:fs";
import { join } from "node:path";
import { ALLOWED_INTERNAL_DEPENDENCIES } from "./package-architecture.rules.ts";
import { defineRule, type Fail, type SourceInventory } from "./policy.ts";
import {
  analyzeImports,
  resolvedImportPath,
  sourceExtensions,
} from "./repository-source-inventory.ts";
const packageByDirectory = new Map(
  [...ALLOWED_INTERNAL_DEPENDENCIES.keys()].map((name) => [
    name.slice("@nervekit/".length),
    name,
  ]),
);

export function checkPackageBoundaries(
  { repoRoot, files: trackedFiles, read }: SourceInventory,
  fail: Fail,
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
      const allowed = ALLOWED_INTERNAL_DEPENDENCIES.get(expectedName) ?? [];
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
      if (!ALLOWED_INTERNAL_DEPENDENCIES.has(manifest.name))
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
      const allowed = ALLOWED_INTERNAL_DEPENDENCIES.get(packageName) ?? [];
      const imports = analyzeImports(read(file), file);
      if (
        imports.nonLiteralDynamicImports.length > 0 &&
        isProtectedStaticImportLayer(file)
      ) {
        fail(file, "protected layer may not use nonliteral dynamic imports");
      }
      for (const specifier of imports.specifiers) {
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
          if (resolved.includes("/workbench-server/src/app/"))
            fail(file, "server adapters may not import from app/");
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
        if (
          packageName === "@nervekit/protocol" &&
          file.startsWith("packages/protocol/src/") &&
          forbiddenProtocolImport(specifier)
        )
          fail(
            file,
            `protocol must remain transport-library-neutral; inject transports through ports: ${specifier}`,
          );
      }
    }
  }

  function packageNameForFile(file: string) {
    const match = /^packages\/([^/]+)\//.exec(file);
    return match ? packageByDirectory.get(match[1]) : undefined;
  }

  function nervePackageName(specifier: string) {
    const match = /^(@nervekit\/[^/]+)/.exec(specifier);
    return match?.[1] ?? specifier;
  }

  function isProtectedStaticImportLayer(file: string) {
    return (
      file.startsWith("packages/contracts/src/") ||
      file.startsWith("packages/protocol/src/") ||
      file.startsWith("packages/workbench-server/src/domains/runs/runtime/") ||
      file.startsWith("packages/workbench-app/src/lib/presentation/")
    );
  }

  function forbiddenRunRuntimeImport(file: string, specifier: string) {
    if (specifier.startsWith("@nervekit/contracts")) return false;
    if (specifier.startsWith("../../../core/ports/")) return false;
    if (!specifier.startsWith(".")) return true;
    return !resolvedImportPath(file, specifier).startsWith(
      "packages/workbench-server/src/domains/runs/runtime/",
    );
  }

  function forbiddenPresentationImport(file: string, specifier: string) {
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

  function forbiddenProtocolImport(specifier: string) {
    return /^(?:node:|hono(?:\/|$)|@hono\/|ws$|electron(?:\/|$)|svelte(?:\/|$)|better-sqlite3$|sqlite3$|(?:http|https|net|tls|fs|child_process)$)/.test(
      specifier,
    );
  }

  function forbiddenContractsImport(specifier: string) {
    // `@nervekit/extension-api` is dependency-free types (the manifests contracts validate).
    return /^(?:@nervekit\/(?!extension-api(?:\/|$))|hono(?:\/|$)|svelte(?:\/|$)|ws$|better-sqlite3$|sqlite3$)/.test(
      specifier,
    );
  }
}

export const packageBoundariesRule = defineRule(
  "package-boundaries",
  "workspace dependency edges, layer imports and protected-layer import constraints",
  checkPackageBoundaries,
);
