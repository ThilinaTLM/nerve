import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function bundleDesktopPreload(
  entryPoint = join(packageDir, "src", "preload.cjs"),
  outfile = join(packageDir, "dist", "preload.cjs"),
) {
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await bundleDesktopPreload();
  // Older builds copied this helper beside the entrypoint. A sandboxed Electron
  // preload cannot load local modules, so ensure stale artifacts do not mask a
  // broken bundle.
  await rm(join(packageDir, "dist", "preload-api.cjs"), { force: true });
}
