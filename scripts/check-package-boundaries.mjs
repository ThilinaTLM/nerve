import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const sourceExtensions = /\.(?:[cm]?[jt]sx?|svelte)$/;
const releaseSurfaceExtensions =
  /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|tsconfig(?:\.[^/]+)?\.json|Dockerfile|[^/]+\.(?:[cm]?[jt]sx?|svelte|md|json|ya?ml|toml|tf|sh))$/;

const allowedNerveDependencies = new Map([
  ["@nervekit/contracts", []],
  ["@nervekit/protocol", ["@nervekit/contracts"]],
  ["@nervekit/harness", ["@nervekit/contracts"]],
  ["@nervekit/tools", ["@nervekit/contracts"]],
  ["@nervekit/ui-kit", []],
  ["@nervekit/website", []],
  [
    "@nervekit/workbench-server",
    [
      "@nervekit/contracts",
      "@nervekit/protocol",
      "@nervekit/harness",
      "@nervekit/tools",
    ],
  ],
  [
    "@nervekit/workbench-app",
    ["@nervekit/contracts", "@nervekit/protocol", "@nervekit/ui-kit"],
  ],
  [
    "@nervekit/desktop-shell",
    ["@nervekit/contracts", "@nervekit/workbench-server"],
  ],
]);

const packageByDirectory = new Map();
for (const [name] of allowedNerveDependencies) {
  const directory = name.slice("@nervekit/".length);
  packageByDirectory.set(directory, name);
}

const trackedFiles = trackedRepositoryFiles();
checkManifestGraph();
checkSourceImports();
checkRetiredSurface();
checkWorkbenchFeatureBoundaries();
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
        specifier !== "@nervekit/contracts"
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
  ];

  for (const file of trackedFiles.filter((path) =>
    releaseSurfaceExtensions.test(path),
  )) {
    const text = read(file);
    for (const name of retiredPackages) {
      if (file !== "docs/release.md" && text.includes(name))
        fail(file, `retired package/path remains: ${name}`);
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

  for (const file of trackedFiles.filter(
    (path) =>
      path.startsWith("packages/workbench-app/src/") &&
      sourceExtensions.test(path),
  )) {
    const text = read(file);
    if (
      /\$lib\/(?:stores|events|audio|hooks|logging|shortcuts|utils)(?:\/|["'])/.test(
        text,
      )
    )
      fail(file, "legacy workbench app import remains");
    if (
      file.includes("/src/lib/app/") &&
      /\$lib\/features\/[a-z0-9-]+\/state\//.test(text)
    )
      fail(
        file,
        "app shell must use feature barrels instead of deep feature state imports",
      );
  }
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
    "packages/harness/src/harness/utils/shell-output.ts",
    "packages/harness/src/harness/utils/truncate.ts",
    "packages/desktop-shell/src/daemon-helpers.ts",
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
  if (specifier === "@nervekit/contracts") return false;
  if (specifier === "../../../core/ports.js") return false;
  if (!specifier.startsWith(".")) return true;
  return !resolvedImportPath(file, specifier).startsWith(
    "packages/workbench-server/src/domains/runs/runtime/",
  );
}

function forbiddenPresentationImport(file, specifier) {
  if (/^\$lib\/(?:app|features|core)(?:\/|$)/.test(specifier)) return true;
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
