import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "../workspace/repo.ts";

/** Sandbox library files (and licenses) shipped as assets: package -> dist file. */
const libraries = [
  { name: "xlsx", file: "dist/xlsx.full.min.js" },
  { name: "papaparse", file: "papaparse.min.js" },
];

const toolsRoot = join(repoRoot, "packages", "tools");
const destination = join(toolsRoot, "dist", "sandbox-libraries");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const { name, file } of libraries) {
  const source = join(toolsRoot, "node_modules", name);
  await cp(join(source, file), join(destination, file.split("/").pop()!));
  await cp(join(source, "LICENSE"), join(destination, `${name}.LICENSE`));
}
