import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeBinding } from "./contract.js";

export const binding = loadBinding();

function loadBinding(): NativeBinding {
  const require = createRequire(import.meta.url);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const binaryName = `nerve_native.${platformTriple()}.node`;
  const candidates = [
    join(moduleDir, "..", "..", "prebuilds", binaryName),
    join(moduleDir, "..", "..", "prebuilds", "local", binaryName),
    join(moduleDir, "..", "..", "..", "prebuilds", binaryName),
    join(moduleDir, "..", "..", "..", "prebuilds", "local", binaryName),
  ];
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return require(candidate) as NativeBinding;
    } catch (error) {
      errors.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  const detail =
    errors.join("; ") ||
    `No native prebuild for ${process.platform}/${process.arch}`;
  throw new Error(`Native runtime failed to load: ${detail}`);
}

function platformTriple(): string {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "linux") return `linux-${process.arch}-gnu`;
  return `${process.platform}-${process.arch}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
