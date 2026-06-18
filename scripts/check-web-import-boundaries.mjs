import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("packages/web")
  ? process.cwd()
  : join(process.cwd(), "packages/web");
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

if (failures.length) {
  console.error("Web import boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
