import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
for (const segment of ["builtin", "guides"]) {
  const source = join(repoRoot, "packages", "skills", "src", segment);
  const destination = join(repoRoot, "packages", "skills", "dist", segment);

  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}
