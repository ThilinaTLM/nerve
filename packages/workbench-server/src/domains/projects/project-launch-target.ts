import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ProjectRecord } from "@nervekit/contracts";
import { ApplicationError } from "../../core/application-error.js";

export async function resolveProjectLaunchTarget(
  project: ProjectRecord,
  rawPath?: string,
  options: { directory?: boolean } = {},
): Promise<string> {
  const root = await canonicalPath(project.dir, "PROJECT_PATH_NOT_FOUND");
  const normalized = normalizeRelativePath(rawPath);
  const lexicalTarget = normalized
    ? resolve(root, ...normalized.split("/"))
    : root;

  if (!isContained(root, lexicalTarget)) {
    throw invalidPath("Project launch path escapes the project root.");
  }

  const target = await canonicalPath(lexicalTarget, "PROJECT_PATH_NOT_FOUND");
  if (!isContained(root, target)) {
    throw invalidPath("Project launch path escapes the project root.");
  }

  if (options.directory) {
    const info = await stat(target);
    if (!info.isDirectory()) {
      throw new ApplicationError(
        400,
        "PROJECT_PATH_NOT_DIRECTORY",
        "Terminal launch path must be a directory.",
      );
    }
  }
  return target;
}

function normalizeRelativePath(rawPath: string | undefined): string {
  if (rawPath === undefined) return "";
  const path = rawPath.trim().replaceAll("\\", "/");
  if (
    !path ||
    path.includes("\0") ||
    path.startsWith("/") ||
    isAbsolute(path)
  ) {
    throw invalidPath("Project launch path must be relative.");
  }
  const segments = path.split("/");
  if (
    /^[A-Za-z]:\//.test(path) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw invalidPath("Project launch path contains an invalid segment.");
  }
  return segments.join("/");
}

async function canonicalPath(path: string, code: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    throw new ApplicationError(
      404,
      code,
      `Project launch path not found: ${path}`,
    );
  }
}

function isContained(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function invalidPath(message: string): ApplicationError {
  return new ApplicationError(400, "INVALID_PROJECT_PATH", message);
}
