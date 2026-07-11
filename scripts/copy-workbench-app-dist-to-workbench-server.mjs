import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workbenchAppDist = join(repoRoot, "packages", "workbench-app", "dist");
const workbenchServerWebDist = join(
  repoRoot,
  "packages",
  "workbench-server",
  "dist",
  "web",
);

await access(join(workbenchAppDist, "index.html")).catch(() => {
  throw new Error(
    `Missing built workbench app at ${workbenchAppDist}. Run pnpm --filter @nervekit/workbench-app build first.`,
  );
});

await mkdir(dirname(workbenchServerWebDist), { recursive: true });
await rm(workbenchServerWebDist, { recursive: true, force: true });
await cp(workbenchAppDist, workbenchServerWebDist, { recursive: true });

console.log(`Copied Web UI assets to ${workbenchServerWebDist}`);
