import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const version = readPackageVersion();

function readPackageVersion(): string {
  const packageJsonPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
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
