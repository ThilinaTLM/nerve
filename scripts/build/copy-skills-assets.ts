import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

const root = join(repoRoot, "packages", "workbench-server");
const source = join(root, "src", "builtin-skills", "builtin");
const destination = join(root, "dist", "builtin-skills", "builtin");

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

// The extension-creator scripts install the SDK that matches this Nerve; installed builds have no
// source checkout to read the version from (see the maintainer note in scripts/lib.mjs).
const { version } = JSON.parse(
  await readFile(join(repoRoot, "package.json"), "utf8"),
) as { version: string };
await writeFile(
  join(destination, "extension-creator", "scripts", "nerve-version.json"),
  `${JSON.stringify({ version })}\n`,
);
