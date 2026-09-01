import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findDependencyCycles,
  resolveWorkbenchImport,
  workbenchBoundaryViolation,
} from "./lib/workbench-boundaries.mjs";
import {
  ALLOWED_STYLE_PARTIALS,
  countClassConsumers,
  extractClassSelectors,
  findBareGlobalSelectors,
  findInertClassNames,
  isDynamicClass,
} from "./lib/style-policy.mjs";
import { allowedNerveDependencies } from "./lib/workspace-architecture.mjs";
import { validatePackageExportSurfaces } from "./lib/package-export-surfaces.mjs";
import { contractsSourcePolicyViolations } from "./lib/contracts-source-policy.mjs";
import { serverTestRuntimePolicyViolations } from "./lib/server-test-runtime-policy.mjs";
import { sourceNamingPolicyViolation } from "./lib/source-naming-policy.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const sourceExtensions = /\.(?:[cm]?[jt]sx?|svelte)$/;
const releaseSurfaceExtensions =
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|tsconfig(?:\.[^/]+)?\.json|Dockerfile|[^/]+\.(?:[cm]?[jt]sx?|svelte|md|json|ya?ml|toml|tf|sh))$/;

const packageByDirectory = new Map();
for (const [name] of allowedNerveDependencies) {
  const directory = name.slice("@nervekit/".length);
  packageByDirectory.set(directory, name);
}

const trackedFiles = trackedRepositoryFiles();
checkManifestGraph();
for (const failure of validatePackageExportSurfaces(repoRoot))
  fail("package exports", failure);
checkSourceImports();
checkContractsSourcePolicy();
checkServerTestRuntimePolicy();
checkSourceNamingPolicy();
checkRetiredSurface();
checkWorkbenchFeatureBoundaries();
checkWorkbenchLayerBoundaries();
checkWorkbenchDependencyCycles();
checkUiStructureAndStyles();
checkRemovedPaths();

if (failures.length > 0) {
  failures.sort();
  console.error("Package boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

function checkManifestGraph() {
  for (const [directory, expectedName] of packageByDirectory) {
    const manifestPath = join(repoRoot, "packages", directory, "package.json");
    if (!existsSync(manifestPath)) {
      fail(
        `packages/${directory}/package.json`,
        `missing manifest for ${expectedName}`,
      );
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
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
      if (dependency.startsWith("@nervekit/") && !allowed.includes(dependency))
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

function checkContractsSourcePolicy() {
  for (const file of trackedFiles) {
    for (const violation of contractsSourcePolicyViolations(file, read(file)))
      fail(file, violation);
  }
}

function checkServerTestRuntimePolicy() {
  for (const file of trackedFiles) {
    for (const violation of serverTestRuntimePolicyViolations(file, read(file)))
      fail(file, violation);
  }
}

function checkSourceNamingPolicy() {
  for (const file of trackedFiles) {
    const violation = sourceNamingPolicyViolation(file);
    if (violation) fail(file, violation);
  }
}

function checkRetiredSurface() {
  const retiredPackages = [
    "@nervekit/" + "agent-runtime",
    "@nervekit/" + "agent-tools",
    "@nervekit/" + "orchestrator",
    "@nervekit/" + "host-runtime",
    "@nervekit/" + "process-runtime",
    "@nervekit/" + "workbench-ui",
    "packages/" + "agent-runtime",
    "packages/" + "agent-tools",
    "packages/" + "orchestrator",
    "packages/" + "host-runtime",
    "packages/" + "process-runtime",
    "packages/" + "workbench-ui",
  ];
  const retiredPathFragments = [
    "/protocol/" + "session.ts",
    "/protocol/" + "manager-protocol-session.ts",
  ];
  const retiredTextFragments = [
    "packages/contracts/src/domains/" + "protocol/",
  ];
  const retiredIdentifiers = [
    "class " + "TaskManager",
    "class " + "RunManager",
    "class " + "HarnessEventBridge",
    "class " + "AgentRunner",
    "class " + "AgentRunSession",
    "interface " + "AgentRunState",
    "type " + "AgentRunState",
    "legacy" + "NervePaths",
    "global" + "ProcessedSeqFromCursor",
    "function " + "launchDesktopRuntime",
  ];

  for (const file of trackedFiles.filter((path) =>
    releaseSurfaceExtensions.test(path),
  )) {
    const text = read(file);
    for (const name of retiredPackages) {
      if (file !== "docs/runbooks/release.md" && text.includes(name))
        fail(file, `retired package/path remains: ${name}`);
    }
    for (const fragment of retiredTextFragments) {
      if (text.includes(fragment))
        fail(file, `retired path reference remains: ${fragment}`);
    }
    for (const identifier of retiredIdentifiers) {
      if (text.includes(identifier))
        fail(file, `retired identifier remains: ${identifier}`);
    }
    if (
      /\brole\s*:\s*["'](?:orchestrator|agent)["']/.test(text) ||
      /"role"\s*:\s*"(?:orchestrator|agent)"/.test(text)
    )
      fail(file, "retired protocol role literal remains");
    if (
      /(?:class|interface|type)\s+ProtocolSession\b/.test(text) &&
      !file.startsWith("packages/protocol/")
    )
      fail(file, "duplicate local ProtocolSession lifecycle owner remains");
  }

  for (const file of trackedFiles) {
    for (const fragment of retiredPathFragments) {
      if (file.endsWith(fragment))
        fail(file, "retired protocol session path returned");
    }
  }
}

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

function checkUiStructureAndStyles() {
  const appSource = trackedFiles.filter(
    (file) =>
      /packages\/workbench-app\/src\//.test(file) &&
      sourceExtensions.test(file),
  );
  for (const file of appSource) {
    const text = read(file);
    if (/Git(?:RepoBranch|Changes|Pr)Section/.test(text))
      fail(file, "apps must compose Git through GitPanelView");
  }

  for (const file of trackedFiles.filter((path) => path.endsWith(".svelte"))) {
    const text = read(file);
    if (/@keyframes\b/.test(text))
      fail(file, "Svelte components may not define @keyframes");
    if (/import\s+["'][^"']+\.css["']/.test(text))
      fail(file, "Svelte components may not import CSS");
  }
  for (const file of trackedFiles.filter(
    (path) => sourceExtensions.test(path) && !path.endsWith(".svelte"),
  )) {
    const text = read(file);
    if (
      /import\s+["'][^"']+\.css["']/.test(text) &&
      !/\/src\/main\.ts$/.test(file)
    )
      fail(file, "CSS imports are allowed only from app src/main.ts entries");
  }

  checkGlobalStylePartials();
  checkBareGlobalSelectors();
  checkInertClassNames();
}

/**
 * A class defined in another component's scoped <style> does nothing when it is
 * copied into a different component. svelte-check cannot see this, so the guard
 * does.
 */
function checkInertClassNames() {
  const components = new Map(
    trackedFiles
      .filter(
        (file) =>
          file.endsWith(".svelte") &&
          /packages\/(?:workbench-app|ui-kit)\/src\//.test(file),
      )
      .map((file) => [file, read(file)]),
  );

  const globalClasses = new Set();
  for (const file of trackedFiles.filter(
    (path) =>
      path.endsWith(".css") &&
      /packages\/(?:workbench-app|ui-kit)\/src\/styles\//.test(path),
  )) {
    for (const className of extractClassSelectors(read(file)))
      globalClasses.add(className);
  }
  for (const [, source] of components) {
    for (const selector of findBareGlobalSelectorsIncludingAllowed(source)) {
      for (const className of extractClassSelectors(selector))
        globalClasses.add(className);
    }
  }

  for (const { file, className, definedIn } of findInertClassNames(
    components,
    globalClasses,
  ))
    fail(
      file,
      `class "${className}" is only defined in ${definedIn.join(", ")}; Svelte scoping makes it inert here`,
    );
}

function findBareGlobalSelectorsIncludingAllowed(source) {
  return [...source.matchAll(/:global\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map(
    (match) => match[1],
  );
}

/**
 * A global CSS partial is an escape from component ownership, so the set of
 * partials is fixed and every class in one must be a real cross-component
 * contract.
 */
function checkGlobalStylePartials() {
  const componentSources = new Map(
    trackedFiles
      .filter((file) => file.endsWith(".svelte") || file.endsWith(".ts"))
      .filter((file) => /packages\/(?:workbench-app|ui-kit)\/src\//.test(file))
      .map((file) => [file, read(file)]),
  );

  for (const [directory, allowed] of ALLOWED_STYLE_PARTIALS) {
    const present = trackedFiles.filter(
      (file) => file.startsWith(`${directory}/`) && file.endsWith(".css"),
    );
    for (const file of present) {
      const name = file.slice(directory.length + 1);
      if (!allowed.includes(name)) {
        fail(
          file,
          "new global CSS partial: style the owning component instead, or add it to ALLOWED_STYLE_PARTIALS in scripts/lib/style-policy.mjs",
        );
        continue;
      }
      for (const className of extractClassSelectors(read(file))) {
        if (isDynamicClass(className)) continue;
        const consumers = countClassConsumers(className, componentSources);
        if (consumers === 0)
          fail(file, `.${className} is not referenced by any component`);
        else if (consumers === 1)
          fail(
            file,
            `.${className} has a single consumer and belongs in that component`,
          );
      }
    }
  }
}

/** A component may not declare an app-wide class from its own <style> block. */
function checkBareGlobalSelectors() {
  for (const file of trackedFiles.filter(
    (path) =>
      path.endsWith(".svelte") &&
      /packages\/(?:workbench-app|ui-kit)\/src\//.test(path),
  )) {
    for (const selector of findBareGlobalSelectors(read(file)))
      fail(
        file,
        `bare :global(${selector}) declares an app-wide class; scope it under a local class or pass it through a child's class prop`,
      );
  }
}

function checkRemovedPaths() {
  const removed = [
    "packages/workbench-app/src/lib/app/layout/ShellPanes.svelte",
    "packages/workbench-app/src/lib/app/layout/AppLayout.svelte",
    "packages/workbench-app/src/lib/app/layout/layout-state.svelte.ts",
    "packages/workbench-app/src/lib/app/layout/UtilityPanel.svelte",
    "packages/workbench-app/src/lib/app/layout/UtilityShell.svelte",
    "packages/workbench-app/src/lib/app/layout/utility-section-preferences.svelte.ts",
    "packages/workbench-app/src/lib/features/projects/components/ProjectAgentTree.svelte",
    "packages/workbench-app/src/lib/presentation/components/workbench/workbench-shell.svelte",
    "packages/workbench-app/src/lib/presentation/components/workbench/workbench-panes.svelte",
    "packages/workbench-app/src/lib/presentation/components/workbench/workbench-utility-panel.svelte",
    "packages/workbench-app/src/lib/presentation/components/workbench/panel-section.svelte",
    "packages/workbench-app/src/lib/presentation/components/workbench/workbench-layout.ts",
    "packages/workbench-app/src/lib/presentation/components/workbench/index.ts",
    "packages/ui-kit/src/styles/components/workbench-layout.css",
    "packages/ui-kit/src/styles/components/workbench-tabs.css",
    "packages/ui-kit/src/styles/components/workbench-utility.css",
    "packages/workbench-app/src/lib/features/conversations/components/composer-todos.ts",
    "packages/workbench-app/src/lib/features/git/components/git-change-format.ts",
    "packages/workbench-app/src/lib/features/git/components/git-remote-actions.ts",
    "packages/workbench-app/src/lib/features/git/components/pr-pane-helpers.ts",
    "packages/workbench-app/components.json",
    "packages/workbench-app/src/lib/core/highlight/highlight.ts",
    "packages/workbench-app/src/lib/core/highlight/highlight.test.ts",
    "packages/workbench-app/src/lib/core/utils/lru-cache.ts",
    "packages/workbench-app/src/lib/core/utils/lru-cache.test.ts",
    "packages/workbench-app/src/lib/core/utils/path-links.ts",
    "packages/workbench-app/src/lib/core/utils/path-links.test.ts",
    "packages/workbench-app/src/lib/core/utils/text-preview.ts",
    "packages/workbench-app/src/lib/core/utils/text-preview.test.ts",
    "packages/harness/src/compaction/types.ts",
    "packages/workbench-app/src/lib/presentation/conversations/types.ts",
    "packages/workbench-app/src/lib/presentation/files/types.ts",
    "packages/workbench-app/src/lib/presentation/settings/types.ts",
    "packages/workbench-app/src/lib/presentation/state/types.ts",
    "packages/workbench-app/src/lib/presentation/tools/lifecycle/types.ts",
    "packages/workbench-app/src/lib/application/workspace/workspace-feature-commands.ts",
    "packages/harness/src/harness/utils/shell-output.ts",
    "packages/harness/src/harness/utils/truncate.ts",
    "packages/desktop-shell/src/daemon-helpers.ts",
    "packages/desktop-shell/src/daemon/adapters/node-launcher.ts",
    "packages/workbench-server/src/app/runtime/types.ts",
    "packages/workbench-server/src/core/ports.ts",
    "packages/workbench-server/src/adapters/protocol/method-handlers.ts",
    "packages/workbench-server/src/adapters/protocol/method-handlers/conversation-agent-method-handlers.ts",
    "packages/workbench-server/src/adapters/protocol/method-handlers/project-task-method-handlers.ts",
    "packages/contracts/test/agent/agent.schema.test.ts",
    "packages/contracts/test/atlassian/atlassian-result-summaries.schema.test.ts",
    "packages/contracts/test/conversation/conversation-state.schema.test.ts",
    "packages/contracts/test/logs/logs.schema.test.ts",
    "packages/contracts/test/permission/permission-rule-sets.schema.test.ts",
    "packages/contracts/test/plan/plan-review.schema.test.ts",
    "packages/contracts/test/providers/providers.schema.test.ts",
    "packages/contracts/test/recorded/recorded-tool-name.schema.test.ts",
    "packages/contracts/test/storage/storage.schema.test.ts",
    "packages/contracts/test/task/task-definition.schema.test.ts",
    "packages/contracts/test/task/task-tool-preview.schema.test.ts",
    "packages/contracts/test/task/task.schema.test.ts",
    "packages/contracts/test/tool/tool-result-payload.schema.test.ts",
    "packages/contracts/test/wire-events/protocol.schema.test.ts",
    "packages/protocol/test/rpc/peer-binding.test.ts",
  ];
  for (const file of removed) {
    if (trackedFiles.includes(file))
      fail(file, "removed duplicate path returned");
  }
}

function importSpecifiers(text) {
  const values = new Set();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:import|require)\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) values.add(match[1]);
  }
  return values;
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

function resolvedImportPath(file, specifier) {
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

function forbiddenContractsImport(specifier) {
  return /^(?:@nervekit\/|hono(?:\/|$)|svelte(?:\/|$)|ws$|better-sqlite3$|sqlite3$)/.test(
    specifier,
  );
}

function trackedRepositoryFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ls-files failed with exit code ${result.status}`);
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => path.split(sep).join("/"))
    .filter((path) => existsSync(join(repoRoot, path)))
    .sort();
}

function read(file) {
  return readFileSync(join(repoRoot, file), "utf8");
}

function fail(file, message) {
  failures.push(`${file}: ${message}`);
}
