import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeBinding } from "./contract.js";
import { errorMessage } from "../core/error.js";

export const binding = loadBinding();

function loadBinding(): NativeBinding {
  const require = createRequire(import.meta.url);
  const triple = platformTriple();
  const packageName = `@nervekit/native-${triple}`;
  const errors: string[] = [];
  let packageMissing = false;

  // Published installs: the per-platform optional dependency. This is a bare
  // specifier so it resolves from wherever this module (or a bundle of it)
  // lives inside the consuming package's node_modules.
  try {
    return require(packageName) as NativeBinding;
  } catch (error) {
    if (isModuleNotFound(error, packageName)) packageMissing = true;
    else errors.push(`${packageName}: ${errorMessage(error)}`);
  }

  // Development and CI: prebuilds next to the workspace package.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const binaryName = `nerve_native.${triple}.node`;
  const candidates = [
    join(moduleDir, "..", "..", "prebuilds", binaryName),
    join(moduleDir, "..", "..", "prebuilds", "local", binaryName),
    join(moduleDir, "..", "..", "..", "prebuilds", binaryName),
    join(moduleDir, "..", "..", "..", "prebuilds", "local", binaryName),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return require(candidate) as NativeBinding;
    } catch (error) {
      errors.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  if (packageMissing)
    errors.push(
      `${packageName} is not installed and no local prebuild was found for ${process.platform}/${process.arch}. ` +
        "Nerve ships its native addon as a per-platform optional dependency: " +
        "reinstall without --no-optional / --omit=optional, " +
        "and check that this platform is supported.",
    );
  const detail = errors.join("; ");
  throw new Error(`Native runtime failed to load: ${detail}`);
}

function isModuleNotFound(error: unknown, specifier: string): boolean {
  const failure = error as { code?: string; message?: string } | null;
  return (
    failure?.code === "MODULE_NOT_FOUND" &&
    typeof failure.message === "string" &&
    failure.message.includes(`'${specifier}'`)
  );
}

function platformTriple(): string {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "linux") return `linux-${process.arch}-gnu`;
  return `${process.platform}-${process.arch}`;
}
