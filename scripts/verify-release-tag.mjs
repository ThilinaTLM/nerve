import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePaths = [
  "package.json",
  join("packages", "contracts", "package.json"),
  join("packages", "protocol", "package.json"),
  join("packages", "harness", "package.json"),
  join("packages", "tools", "package.json"),
  join("packages", "host-runtime", "package.json"),
  join("packages", "workbench-server", "package.json"),
  join("packages", "workbench-ui", "package.json"),
  join("packages", "workbench-app", "package.json"),
  join("packages", "desktop-shell", "package.json"),
  join("packages", "sandbox-agent", "package.json"),
  join("packages", "sandbox-manager", "package.json"),
  join("packages", "sandbox-manager-app", "package.json"),
];

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const rawTag = args[0] ?? process.env.GITHUB_REF_NAME ?? "";
const tag = rawTag.replace(/^refs\/tags\//, "");
if (!tag) {
  throw new Error(
    "Missing release tag. Pass a tag argument or set GITHUB_REF_NAME.",
  );
}

const versions = new Map();
for (const relativePath of packagePaths) {
  const packageJson = await readJson(join(repoRoot, relativePath));
  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error(`${relativePath} does not declare a version.`);
  }
  versions.set(relativePath, packageJson.version);
}

const rootVersion = versions.get("package.json");
const mismatches = [...versions.entries()].filter(
  ([, version]) => version !== rootVersion,
);
if (mismatches.length > 0) {
  throw new Error(
    `Workspace package versions must match root version ${rootVersion}:\n${mismatches
      .map(([path, version]) => `  ${path}: ${version}`)
      .join("\n")}`,
  );
}

const expectedTag = `v${rootVersion}`;
if (tag !== expectedTag) {
  throw new Error(
    `Release tag ${tag} does not match package version ${rootVersion}. Expected ${expectedTag}.`,
  );
}

console.log(`Release tag ${tag} matches workspace version ${rootVersion}.`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
