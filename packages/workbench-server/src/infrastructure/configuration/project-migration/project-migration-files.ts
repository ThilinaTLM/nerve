import { NewerLegacyVersion } from "./project-input-error.js";
import { createHash } from "node:crypto";
import { readFile, mkdir, open, realpath, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ProjectConfigurationContext,
  ProjectLegacyInput,
  ProjectLegacySource,
} from "./project-migration.js";
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export async function bytes(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function projectPath(
  directory: string,
  path: string,
): Promise<string> {
  const root = resolve(directory, ".nerve");
  const target = resolve(root, path);
  const local = relative(root, target);
  if (!local || local.startsWith("..") || isAbsolute(local))
    throw new Error("Configuration path must be under project .nerve");
  const actualProject = await resolveExisting(resolve(directory));
  const actualRoot = await resolveExisting(root);
  assertWithin(actualProject, actualRoot);
  const actualTarget = await resolveExisting(target);
  assertWithin(actualRoot, actualTarget);
  return actualTarget;
}
export async function homePath(home: string, path: string): Promise<string> {
  const target = resolve(home, path);
  const local = relative(resolve(home), target);
  if (
    !local ||
    local === ".." ||
    local.startsWith(`..${sep}`) ||
    isAbsolute(local)
  )
    throw new Error("Legacy source must be under the Nerve home");
  const actualHome = await resolveExisting(resolve(home));
  const actualTarget = await resolveExisting(target);
  assertWithin(actualHome, actualTarget);
  return actualTarget;
}
async function resolveExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if ((await lstat(path).catch(() => undefined))?.isSymbolicLink())
      throw new Error(
        "Dangling configuration link; remove it manually and reload",
        { cause: error },
      );
    return join(
      await resolveExisting(dirname(path)),
      path.slice(dirname(path).length + 1),
    );
  }
}

export async function quarantine(
  home: string,
  context: ProjectConfigurationContext,
  path: string,
  source: Buffer,
): Promise<void> {
  const target = join(
    home,
    "quarantine",
    "project-configuration",
    digest(context.projectId),
    digest(path),
    `${digest(source)}.original`,
  );
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const file = await open(target, "wx", 0o600).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      if (!(await readFile(target)).equals(source))
        throw new Error("Quarantine original differs from source");
      return undefined;
    },
  );
  if (!file) return;
  try {
    await file.writeFile(source);
    await file.sync();
  } finally {
    await file.close();
  }
  const directory = await open(dirname(target), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function assertWithin(root: string, target: string): void {
  const local = relative(root, target);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error(
      "Symlinked configuration path escapes its owning root; remove the link manually and reload",
    );
}

export function decodeConfiguration(
  source: Buffer,
  decode: (value: string) => unknown = JSON.parse,
): unknown {
  const text = source.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(source))
    throw new Error("Non-UTF8 configuration; original bytes were preserved");
  return decode(text);
}

export function legacyVersion(
  value: unknown,
  source: ProjectLegacyInput | ProjectLegacySource,
  fallback: { field: string; absent: number },
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a legacy configuration object");
  const accessor = source.version ?? fallback;
  const raw = value as Record<string, unknown>;
  const version = Object.hasOwn(raw, accessor.field)
    ? raw[accessor.field]
    : accessor.absent;
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new Error("Unrecognisable legacy configuration version");
  if (version > source.currentVersion)
    throw new NewerLegacyVersion(
      "This legacy configuration requires a newer Nerve version. The file is read-only.",
    );
  return { ...raw, [accessor.field]: version };
}
