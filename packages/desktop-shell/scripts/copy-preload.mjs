import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const destinationDir = join(packageDir, "dist");
const preloadFiles = ["preload.cjs", "preload-api.cjs"];

await mkdir(destinationDir, { recursive: true });
await Promise.all(
  preloadFiles.map((file) =>
    copyFile(join(packageDir, "src", file), join(destinationDir, file)),
  ),
);
