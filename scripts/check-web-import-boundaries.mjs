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
  }
}

walk(join(root, "src"));

if (failures.length) {
  console.error("Web import boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
