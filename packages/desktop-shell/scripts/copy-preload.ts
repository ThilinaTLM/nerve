import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { defineCli } from "../../../scripts/cli/main.ts";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleDesktopPreload(
  entryPoint: string = join(packageDir, "src", "preload.cjs"),
  outfile: string = join(packageDir, "dist", "preload.cjs"),
): Promise<void> {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: ["electron"],
  });
}

await defineCli(import.meta.url, async () => {
  await bundleDesktopPreload();
  // Older builds copied this helper beside the entrypoint. A sandboxed Electron
  // preload cannot load local modules, so ensure stale artifacts do not mask a
  // broken bundle.
  await rm(join(packageDir, "dist", "preload-api.cjs"), { force: true });
});
