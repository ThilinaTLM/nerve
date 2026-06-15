import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(
  repoRoot,
  process.argv[2] ?? join("packages", "desktop", "release"),
);
const artifactExtensions = new Set([".AppImage", ".deb", ".rpm"]);

const entries = await readdir(releaseDir, { withFileTypes: true });
const artifacts = entries
  .filter(
    (entry) => entry.isFile() && artifactExtensions.has(extname(entry.name)),
  )
  .map((entry) => join(releaseDir, entry.name))
  .sort((left, right) => basename(left).localeCompare(basename(right)));

if (artifacts.length === 0) {
  throw new Error(
    `No Linux release artifacts found in ${releaseDir}. Expected .AppImage, .deb, or .rpm files.`,
  );
}

const lines = [];
for (const artifact of artifacts) {
  const contents = await readFile(artifact);
  const digest = createHash("sha256").update(contents).digest("hex");
  lines.push(`${digest}  ${basename(artifact)}`);
}

const checksumPath = join(releaseDir, "SHA256SUMS");
await writeFile(checksumPath, `${lines.join("\n")}\n`);
console.log(`Wrote ${checksumPath}`);
