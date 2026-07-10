import { mkdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { resolveToolPath } from "@nervekit/host-runtime/tools";

export function planDirForStorageHome(storageHome: string): string {
  return resolve(join(storageHome, "plans"));
}

export async function ensurePlanDir(storageHome: string): Promise<string> {
  const dir = planDirForStorageHome(storageHome);
  await mkdir(dir, { recursive: true, mode: 0o755 });
  return dir;
}

export function isPathInsidePlanDir(
  planDir: string,
  candidatePath: string,
): boolean {
  const relativePath = relative(planDir, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export function resolvePlanPath(cwd: string, input: unknown): string {
  return resolveToolPath(cwd, input);
}

export function planSlugFromPath(filePath: string): string {
  const name = basename(filePath).replace(/\.md$/i, "");
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 80);
  return slug || "plan";
}
