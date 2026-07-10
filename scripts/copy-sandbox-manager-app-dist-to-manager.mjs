import { cp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "packages", "sandbox-manager-app", "dist");
const destination = join(root, "packages", "sandbox-manager", "dist", "web");
const indexHtml = join(source, "index.html");

try {
  const info = await stat(indexHtml);
  if (!info.isFile()) throw new Error("not a file");
} catch {
  console.error(
    `Sandbox manager UI dist is missing: ${indexHtml}\nRun: pnpm --filter @nervekit/sandbox-manager-app build`,
  );
  process.exit(1);
}

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`Copied sandbox manager UI dist to ${destination}`);
