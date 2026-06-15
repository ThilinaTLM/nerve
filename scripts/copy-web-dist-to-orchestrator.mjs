import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDist = join(repoRoot, "packages", "web", "dist");
const orchestratorWebDist = join(
  repoRoot,
  "packages",
  "orchestrator",
  "dist",
  "web",
);

await access(join(webDist, "index.html")).catch(() => {
  throw new Error(
    `Missing built Web UI at ${webDist}. Run pnpm --filter @nerve/web build first.`,
  );
});

await mkdir(dirname(orchestratorWebDist), { recursive: true });
await rm(orchestratorWebDist, { recursive: true, force: true });
await cp(webDist, orchestratorWebDist, { recursive: true });

console.log(`Copied Web UI assets to ${orchestratorWebDist}`);
