import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(repoRoot, "packages", "workbench-app");
const libRoot = join(root, "src/lib");
const bannedTopLevel = [
  "stores",
  "events",
  "audio",
  "hooks",
  "logging",
  "shortcuts",
  "utils",
];
const bannedImportPatterns = [
  /\$lib\/(stores|events|audio|hooks|logging|shortcuts|utils)(\/|['"])/,
  /(?:^|["'])\.\.?\/.*\/(stores|events)\//,
];

const failures = [];
for (const dir of bannedTopLevel) {
  const path = join(libRoot, dir);
  if (existsSync(path))
    failures.push(
      `legacy top-level directory remains: ${relative(root, path)}`,
    );
}

// The app shell must compose features through their public barrels
// (`$lib/features/<feature>`), never by reaching into a feature's internal
// state modules (`$lib/features/<feature>/state/...`).
const appDeepStateImport = /\$lib\/features\/[a-z0-9-]+\/state\//;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(svelte|ts|js)$/.test(entry)) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of bannedImportPatterns) {
      if (pattern.test(text)) {
        failures.push(`legacy import in ${relative(root, path)}: ${pattern}`);
        break;
      }
    }
    if (
      path.includes(`${join("src", "lib", "app")}/`) &&
      appDeepStateImport.test(text)
    ) {
      failures.push(
        `app must use feature barrels, not deep state imports: ${relative(root, path)}`,
      );
    }
  }
}

walk(join(root, "src"));

const workbenchUiRoot = join(repoRoot, "packages", "workbench-ui", "src");
const sandboxManagerAppRoot = join(
  repoRoot,
  "packages",
  "sandbox-manager-app",
  "src",
);
const hostImportPattern =
  /(?:from\s+["'](?:\$lib\/|@nervekit\/(?:workbench-app|sandbox-manager-app|orchestrator|desktop-shell))|import\(["'](?:\$lib\/|@nervekit\/(?:workbench-app|sandbox-manager-app|orchestrator|desktop-shell)))/;
const workbenchAppImportPattern =
  /(?:from\s+["']@nervekit\/workbench-app|import\(["']@nervekit\/workbench-app)/;

function scanBoundary(dir, packageRoot, pattern, label) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      scanBoundary(path, packageRoot, pattern, label);
      continue;
    }
    if (!/\.(svelte|ts|js)$/.test(entry)) continue;
    if (pattern.test(readFileSync(path, "utf8"))) {
      failures.push(`${label}: ${relative(packageRoot, path)}`);
    }
  }
}

scanBoundary(
  workbenchUiRoot,
  join(repoRoot, "packages", "workbench-ui"),
  hostImportPattern,
  "workbench-ui imports a host module",
);
scanBoundary(
  sandboxManagerAppRoot,
  join(repoRoot, "packages", "sandbox-manager-app"),
  workbenchAppImportPattern,
  "sandbox-manager-app imports workbench-app",
);

for (const removed of [
  join(root, "src/lib/app/layout/ShellPanes.svelte"),
  join(root, "src/lib/features/conversations/components/composer-todos.ts"),
  join(
    repoRoot,
    "packages/sandbox-manager-app/src/lib/components/composer/SandboxPromptComposer.svelte",
  ),
  join(
    repoRoot,
    "packages/sandbox-manager-app/src/lib/state/sandbox-chat-render.ts",
  ),
]) {
  if (existsSync(removed)) {
    failures.push(
      `removed duplicate path returned: ${relative(repoRoot, removed)}`,
    );
  }
}

if (failures.length) {
  console.error("Workbench app import boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
