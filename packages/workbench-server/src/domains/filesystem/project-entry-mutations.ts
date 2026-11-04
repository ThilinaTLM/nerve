import {
  cp,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { isPathInside } from "@nervekit/tools/execution";
import {
  FILESYSTEM_PROJECT_UPLOAD_MAX_FILES,
  FILESYSTEM_PROJECT_UPLOAD_MAX_FILE_BYTES,
  FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES,
  type FilesystemProjectEntry,
  filesystemProjectEntriesDeleteRequestSchema,
  filesystemProjectEntryCopyRequestSchema,
  filesystemProjectEntryMoveRequestSchema,
} from "@nervekit/contracts/filesystem";
import { ApplicationError } from "../../core/application-error.js";
import { normalizeProjectRelativeDirectory } from "./project-listing.js";

type ProjectDirectoryResolver = (projectId: string) => string;

function invalid(message: string, code = "INVALID_PROJECT_PATH") {
  return new ApplicationError(400, code, message);
}

function normalizeEntryPath(raw: string): string {
  let path: string;
  try {
    path = normalizeProjectRelativeDirectory(raw);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  if (!path) throw invalid("The project root cannot be modified.");
  return path;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function lstatOrUndefined(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function projectRoot(
  projectId: string,
  getProjectDirectory: ProjectDirectoryResolver,
): Promise<string> {
  return realpath(resolve(getProjectDirectory(projectId)));
}

/**
 * Resolves `relativePath` under `root` without following symbolic links in any
 * ancestor directory. The final component may itself be a link (it is operated
 * on as a link, never followed).
 */
async function resolveEntry(root: string, relativePath: string) {
  const absolute = resolve(root, relativePath);
  if (!isPathInside(root, absolute) || absolute === root)
    throw new ApplicationError(
      403,
      "FILE_PATH_OUTSIDE_PROJECT",
      "Path escapes the project root.",
    );
  const parent = resolve(absolute, "..");
  let realParent: string;
  try {
    realParent = await realpath(parent);
  } catch (error) {
    if (isMissing(error))
      throw new ApplicationError(
        404,
        "PROJECT_ENTRY_NOT_FOUND",
        "The parent folder does not exist.",
      );
    throw error;
  }
  if (realParent !== parent)
    throw new ApplicationError(
      403,
      "FILE_PATH_OUTSIDE_PROJECT",
      "Project paths cannot traverse a symbolic link.",
    );
  return absolute;
}

async function entryFor(
  absolute: string,
  path: string,
): Promise<FilesystemProjectEntry> {
  const info = await lstat(absolute);
  let kind: FilesystemProjectEntry["kind"] = info.isDirectory()
    ? "directory"
    : info.isFile()
      ? "file"
      : "other";
  if (info.isSymbolicLink()) {
    try {
      const target = await stat(absolute);
      kind = target.isDirectory()
        ? "directory"
        : target.isFile()
          ? "file"
          : "other";
    } catch {
      kind = "other";
    }
  }
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    kind,
    symlink: info.isSymbolicLink(),
  };
}

async function prepareTransfer(
  input: unknown,
  schema: typeof filesystemProjectEntryMoveRequestSchema,
  getProjectDirectory: ProjectDirectoryResolver,
) {
  const request = schema.parse(input);
  const from = normalizeEntryPath(request.from);
  const to = normalizeEntryPath(request.to);
  const root = await projectRoot(request.projectId, getProjectDirectory);
  const source = await resolveEntry(root, from);
  const target = await resolveEntry(root, to);
  const sourceInfo = await lstatOrUndefined(source);
  if (!sourceInfo)
    throw new ApplicationError(
      404,
      "PROJECT_ENTRY_NOT_FOUND",
      `${from} does not exist.`,
    );
  if (to === from || to.startsWith(`${from}/`))
    throw invalid(
      "A folder cannot be moved or copied into itself.",
      "PROJECT_ENTRY_INTO_SELF",
    );
  if (await lstatOrUndefined(target))
    throw new ApplicationError(
      409,
      "PROJECT_ENTRY_EXISTS",
      `${to} already exists.`,
    );
  const parentInfo = await stat(resolve(target, ".."));
  if (!parentInfo.isDirectory())
    throw invalid("The destination parent is not a folder.");
  return { source, target, to };
}

export async function moveProjectEntry(
  input: unknown,
  getProjectDirectory: ProjectDirectoryResolver,
) {
  const { source, target, to } = await prepareTransfer(
    input,
    filesystemProjectEntryMoveRequestSchema,
    getProjectDirectory,
  );
  await rename(source, target);
  return { entry: await entryFor(target, to) };
}

export async function copyProjectEntry(
  input: unknown,
  getProjectDirectory: ProjectDirectoryResolver,
) {
  const { source, target, to } = await prepareTransfer(
    input,
    filesystemProjectEntryCopyRequestSchema,
    getProjectDirectory,
  );
  await cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    dereference: false,
    verbatimSymlinks: true,
  });
  return { entry: await entryFor(target, to) };
}

export async function deleteProjectEntries(
  input: unknown,
  getProjectDirectory: ProjectDirectoryResolver,
) {
  const request = filesystemProjectEntriesDeleteRequestSchema.parse(input);
  const root = await projectRoot(request.projectId, getProjectDirectory);
  const paths = [...new Set(request.paths.map(normalizeEntryPath))];
  // Resolve everything first so one bad path rejects the batch before deleting.
  const resolved = await Promise.all(
    paths.map(async (path) => ({
      path,
      absolute: await resolveEntry(root, path),
    })),
  );
  const deleted: string[] = [];
  for (const { path, absolute } of resolved) {
    if (!(await lstatOrUndefined(absolute))) continue;
    await rm(absolute, { recursive: true, force: true });
    deleted.push(path);
  }
  return { deleted };
}

export type ProjectUploadFile = {
  /** Relative name; may contain "/" for nested folders. */
  name: string;
  size: number;
  bytes(): Promise<Uint8Array>;
};

function uploadSegments(rawName: string): string[] {
  const name = rawName.replaceAll("\\", "/");
  const segments = name.split("/");
  if (
    name.includes("\0") ||
    name.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new ApplicationError(
      400,
      "INVALID_UPLOAD_NAME",
      `Invalid file name: ${rawName || "(empty)"}.`,
    );
  return segments;
}

export async function uploadProjectFiles(
  request: {
    projectId: string;
    path: string;
    overwrite?: boolean;
    files: ProjectUploadFile[];
  },
  getProjectDirectory: ProjectDirectoryResolver,
) {
  const { files } = request;
  if (files.length === 0)
    throw new ApplicationError(400, "INVALID_UPLOAD", "No files to upload.");
  if (files.length > FILESYSTEM_PROJECT_UPLOAD_MAX_FILES)
    throw new ApplicationError(
      413,
      "UPLOAD_TOO_LARGE",
      `At most ${FILESYSTEM_PROJECT_UPLOAD_MAX_FILES} files can be uploaded at once.`,
    );
  let total = 0;
  for (const file of files) {
    if (file.size > FILESYSTEM_PROJECT_UPLOAD_MAX_FILE_BYTES)
      throw new ApplicationError(
        413,
        "UPLOAD_TOO_LARGE",
        `${file.name} exceeds the ${FILESYSTEM_PROJECT_UPLOAD_MAX_FILE_BYTES / 1024 / 1024} MiB per-file upload limit.`,
      );
    total += file.size;
  }
  if (total > FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES)
    throw new ApplicationError(
      413,
      "UPLOAD_TOO_LARGE",
      `Uploads are limited to ${FILESYSTEM_PROJECT_UPLOAD_MAX_TOTAL_BYTES / 1024 / 1024} MiB in total.`,
    );

  let directory: string;
  try {
    directory = normalizeProjectRelativeDirectory(request.path);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  const root = await projectRoot(request.projectId, getProjectDirectory);
  const base = resolve(root, directory);
  if (!isPathInside(root, base))
    throw new ApplicationError(
      403,
      "FILE_PATH_OUTSIDE_PROJECT",
      "Path escapes the project root.",
    );
  if ((await realpath(base)) !== base)
    throw new ApplicationError(
      403,
      "FILE_PATH_OUTSIDE_PROJECT",
      "Project paths cannot traverse a symbolic link.",
    );
  if (!(await stat(base)).isDirectory())
    throw invalid("The upload destination is not a folder.");

  // Plan and check every target before writing anything.
  const planned = files.map((file) => ({
    file,
    segments: uploadSegments(file.name),
  }));
  const seen = new Set<string>();
  const conflicts: string[] = [];
  for (const { file, segments } of planned) {
    const key = segments.join("/");
    if (seen.has(key)) {
      conflicts.push(key);
      continue;
    }
    seen.add(key);
    let current = base;
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const info = await lstatOrUndefined(current);
      if (!info) break;
      const last = index === segments.length - 1;
      if (last) {
        if (!(request.overwrite && info.isFile())) conflicts.push(key);
      } else if (!info.isDirectory()) {
        conflicts.push(key);
        break;
      }
    }
    void file;
  }
  if (conflicts.length > 0) {
    const shown = conflicts.slice(0, 3).join(", ");
    const more =
      conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : "";
    throw new ApplicationError(
      409,
      "PROJECT_ENTRY_EXISTS",
      `${shown}${more} already exist${conflicts.length === 1 ? "s" : ""} in the destination.`,
    );
  }

  const entries: FilesystemProjectEntry[] = [];
  for (const { file, segments } of planned) {
    let current = base;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      const info = await lstatOrUndefined(current);
      if (!info) await mkdir(current);
      else if (!info.isDirectory())
        throw new ApplicationError(
          409,
          "PROJECT_ENTRY_EXISTS",
          `${segment} is not a folder.`,
        );
    }
    const target = join(current, segments.at(-1)!);
    const relative = [directory, ...segments].filter(Boolean).join("/");
    const data = await file.bytes();
    if (request.overwrite) {
      const existing = await lstatOrUndefined(target);
      if (existing && !existing.isFile())
        throw new ApplicationError(
          409,
          "PROJECT_ENTRY_EXISTS",
          `${relative} already exists.`,
        );
      await writeFile(target, data);
    } else {
      try {
        await writeFile(target, data, { flag: "wx" });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
          throw new ApplicationError(
            409,
            "PROJECT_ENTRY_EXISTS",
            `${relative} already exists.`,
          );
        throw error;
      }
    }
    entries.push({
      name: segments.at(-1)!,
      path: relative,
      kind: "file",
      symlink: false,
    });
  }
  return { entries };
}
