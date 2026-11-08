import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot } from "../infrastructure/package-root.js";

export const version = readPackageVersion();

function readPackageVersion(): string {
  const packageJsonPath = join(
    findPackageRoot(import.meta.url),
    "package.json",
  );

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}
