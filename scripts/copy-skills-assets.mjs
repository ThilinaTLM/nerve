import { cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generate,
  verifyBudget,
} from "../packages/skills/src/builtin/richdoc/build/build.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "packages", "skills", "src", "builtin");
const destination = join(repoRoot, "packages", "skills", "dist", "builtin");
await mkdir(dirname(destination), { recursive: true });
const staging = await mkdtemp(join(dirname(destination), ".builtin-"));
try {
  await cp(source, staging, {
    recursive: true,
    // Source ignores would otherwise cause npm to omit the generated runtime.
    filter: (path) =>
      !path
        .split(/[\\/]/)
        .some((part) =>
          ["node_modules", ".cache", ".venv", ".gitignore"].includes(part),
        ),
  });
  await verifyBudget(await generate(join(staging, "richdoc")));
  // Never expose half-generated vendor bundles, manifests or schema helpers.
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
} finally {
  await rm(staging, { recursive: true, force: true });
}
