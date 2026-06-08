import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(packageDir, "src", "preload.cjs");
const destination = join(packageDir, "dist", "preload.cjs");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
