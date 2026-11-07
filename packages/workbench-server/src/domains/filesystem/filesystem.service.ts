import { isHiddenDirectory } from "./filesystem-browser.js";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import { createInterface } from "node:readline";
import { isPathInside, resolveNativePath } from "@nervekit/tools/execution";
import {
  attachmentUploadRequestSchema,
  ATTACHMENT_MAX_BYTES,
  type FilesystemProjectEntry,
  type FilesystemSignal,
  filesystemFileQuerySchema,
  filesystemFileSaveRequestSchema,
  filesystemProjectEntryCreateRequestSchema,
} from "@nervekit/contracts/filesystem";
import {
  mapBatched,
  normalizeProjectRelativeDirectory,
} from "./project-listing.js";
import { ApplicationError } from "../../core/application-error.js";
import { atomicWriteFile } from "../../infrastructure/storage-bootstrap/file-mutations.js";
import { storagePaths } from "../../infrastructure/storage-bootstrap/paths.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function anyPathExists(paths: string[]): Promise<boolean> {
  return (await Promise.all(paths.map(pathExists))).some(Boolean);
}

async function detectDirectorySignals(
  dir: string,
): Promise<FilesystemSignal[]> {
  const checks = await Promise.all([
    pathExists(join(dir, ".git")),
    pathExists(join(dir, "package.json")),
    anyPathExists([
      join(dir, "pnpm-workspace.yaml"),
      join(dir, "lerna.json"),
      join(dir, "nx.json"),
      join(dir, "turbo.json"),
      join(dir, "yarn.lock"),
    ]),
    anyPathExists([
      join(dir, "pyproject.toml"),
      join(dir, "requirements.txt"),
      join(dir, "setup.py"),
    ]),
    pathExists(join(dir, "Cargo.toml")),
    pathExists(join(dir, "go.mod")),
  ]);

  const signals: FilesystemSignal[] = [];
  if (checks[0]) signals.push("git");
  if (checks[1]) signals.push("package");
  if (checks[2]) signals.push("workspace");
  if (checks[3]) signals.push("python");
  if (checks[4]) signals.push("rust");
  if (checks[5]) signals.push("go");
  return signals;
}

const imageExtensionByMime = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
  ["image/avif", "avif"],
]);

function slugifyName(name: string | undefined): string {
  const base = name?.trim()
    ? name.trim().replace(extname(name.trim()), "")
    : "attachment";
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "attachment"
  );
}

function timestampSlug(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function saveAttachment(input: unknown, storageHome: string) {
  if (
    typeof input === "object" &&
    input !== null &&
    "dataBase64" in input &&
    typeof input.dataBase64 === "string" &&
    input.dataBase64.length > Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4
  )
    throw new ApplicationError(
      413,
      "ATTACHMENT_TOO_LARGE",
      "Attachments must be 20 MiB or smaller.",
    );
  const parsed = attachmentUploadRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new ApplicationError(
      422,
      "INVALID_ATTACHMENT",
      "Invalid attachment request.",
    );
  const request = parsed.data;
  const encoded = request.dataBase64;
  const decodedLength =
    (encoded.length / 4) * 3 -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (decodedLength > ATTACHMENT_MAX_BYTES)
    throw new ApplicationError(
      413,
      "ATTACHMENT_TOO_LARGE",
      "Attachments must be 20 MiB or smaller.",
    );
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new ApplicationError(
      422,
      "INVALID_ATTACHMENT",
      "Invalid attachment encoding.",
    );
  const data = Buffer.from(encoded, "base64");
  if (data.toString("base64") !== encoded)
    throw new ApplicationError(
      422,
      "INVALID_ATTACHMENT",
      "Invalid attachment encoding.",
    );
  const suppliedExtension = extname(request.name ?? "")
    .slice(1)
    .toLowerCase();
  const ext =
    imageExtensionByMime.get(request.type.toLowerCase()) ??
    (/^[a-z0-9]{1,16}$/.test(suppliedExtension) ? suppliedExtension : "bin");
  const dir = storagePaths(storageHome).imagesPath;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stem = `${slugifyName(request.name)}-${timestampSlug()}`;
  for (let attempt = 1; attempt <= 100; attempt++) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const filePath = join(dir, `${stem}${suffix}.${ext}`);
    try {
      await writeFile(filePath, data, { flag: "wx", mode: 0o600 });
      return { path: filePath };
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
  }
  throw new ApplicationError(
    409,
    "ATTACHMENT_NAME_COLLISION",
    "Could not store the attachment because too many files share its name. Try again.",
  );
}

export async function directoryListing(
  path: string | undefined,
  showHidden = false,
) {
  const target = resolve(path?.trim() || homedir() || tmpdir());
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new Error(`${target} is not a directory.`);
  }
  const root = parse(target).root;
  const entries = (await readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .filter(
      (entry) => showHidden || !isHiddenDirectory(join(target, entry.name)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: target,
    parent: target === root ? undefined : dirname(target),
    signals: await detectDirectorySignals(target),
    entries: await mapBatched(entries, 16, async (entry) => {
      const entryPath = join(target, entry.name);
      return {
        name: entry.name,
        path: entryPath,
        kind: "directory" as const,
        hidden: isHiddenDirectory(entryPath),
        signals: await detectDirectorySignals(entryPath),
      };
    }),
  };
}

function normalizeProjectEntryName(rawName: string): string {
  const name = rawName.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("\0") ||
    name.includes("/") ||
    name.includes("\\")
  )
    throw new Error("Project entry name must be a single path segment.");
  return name;
}

export async function createProjectEntry(
  input: unknown,
  getProjectDirectory: (projectId: string) => string,
) {
  const request = filesystemProjectEntryCreateRequestSchema.parse(input);
  const parentPath = normalizeProjectRelativeDirectory(request.parentPath);
  const name = normalizeProjectEntryName(request.name);
  const root = await realpath(resolve(getProjectDirectory(request.projectId)));
  const parent = resolve(root, parentPath);
  if (!isInside(root, parent))
    throw new Error("Project directory path escapes the project root.");

  const resolvedParent = await realpath(parent);
  if (!isInside(root, resolvedParent) || resolvedParent !== parent)
    throw new Error("Project entry parent cannot traverse a symbolic link.");
  const parentInfo = await stat(resolvedParent);
  if (!parentInfo.isDirectory())
    throw new Error(`${parentPath || "."} is not a directory.`);

  const target = join(resolvedParent, name);
  if (request.kind === "file") {
    const handle = await open(target, "wx");
    await handle.close();
  } else {
    await mkdir(target);
  }

  const path = parentPath ? `${parentPath}/${name}` : name;
  return {
    entry: {
      name,
      path,
      kind: request.kind,
      symlink: false,
    } satisfies FilesystemProjectEntry,
  };
}

export const MAX_EDITABLE_FILE_BYTES = 1024 * 1024;
const maxTextBytes = MAX_EDITABLE_FILE_BYTES;
const maxImageBytes = 5 * 1024 * 1024;
const lineWindowBefore = 200;
const lineWindowAfter = 800;

const imageMimeByExtension = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".avif", "image/avif"],
]);

const textExtensions = new Set([
  ".bash",
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  // SVG is text so it can be edited; the client renders its preview.
  ".svg",
  ".env",
  ".go",
  ".h",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".svelte",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

function isInside(root: string, candidate: string): boolean {
  return isPathInside(root, candidate);
}

export function normalizeIncomingFilePath(
  root: string,
  rawPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return resolveNativePath(root, rawPath, platform);
}

function resolveProjectFile(root: string, rawPath: string): string {
  return normalizeIncomingFilePath(root, rawPath);
}

async function readFileChunk(path: string, bytes: number): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

function looksTextual(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  return buffer.toString("utf8").includes("�") === false;
}

function fileRevision(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readTextLineWindow(
  path: string,
  targetLine: number,
): Promise<{ text: string; lineStart: number }> {
  const startLine = Math.max(1, targetLine - lineWindowBefore);
  const endLine = targetLine + lineWindowAfter;
  const lines: string[] = [];
  let lineStart = startLine;
  let bytes = 0;
  let lineNumber = 0;

  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    lineNumber += 1;
    if (lineNumber < startLine) continue;
    if (lineNumber > endLine) break;

    const lineBytes = Buffer.byteLength(line) + 1;
    if (lines.length > 0 && bytes + lineBytes > maxTextBytes) break;

    if (lines.length === 0) lineStart = lineNumber;
    lines.push(line);
    bytes += lineBytes;
  }

  return { text: lines.join("\n"), lineStart };
}

export async function fileContent(
  input: unknown,
  getProjectDirectory: (projectId: string) => string,
) {
  const query = filesystemFileQuerySchema.parse(input);
  const root = resolve(getProjectDirectory(query.projectId));
  const target = resolveProjectFile(root, query.path.trim());
  const [info, linkInfo, realRoot, realTarget] = await Promise.all([
    stat(target),
    lstat(target),
    realpath(root),
    realpath(target),
  ]);
  if (info.isDirectory()) throw new Error(`${target} is a directory.`);

  const insideProject = isInside(root, target);
  const editable =
    insideProject &&
    isInside(realRoot, realTarget) &&
    !linkInfo.isSymbolicLink();
  const relativePath = (
    insideProject ? relative(root, target) : target
  ).replaceAll("\\", "/");
  const ext = extname(target).toLowerCase();
  const imageMimeType = imageMimeByExtension.get(ext);

  if (imageMimeType) {
    if (info.size > maxImageBytes) {
      return {
        projectId: query.projectId,
        path: target,
        relativePath,
        name: basename(target),
        size: info.size,
        mtimeMs: info.mtimeMs,
        type: "binary" as const,
        binary: true,
        mimeType: imageMimeType,
        truncated: true,
        editable: false,
      };
    }
    const chunk = await readFileChunk(target, info.size);
    return {
      projectId: query.projectId,
      path: target,
      relativePath,
      name: basename(target),
      size: info.size,
      mtimeMs: info.mtimeMs,
      type: "image" as const,
      binary: false,
      dataBase64: chunk.toString("base64"),
      mimeType: imageMimeType,
      truncated: false,
      editable: false,
    };
  }

  const readBytes = Math.min(info.size, maxTextBytes + 1);
  const chunk = await readFileChunk(target, readBytes);
  const truncated = info.size > maxTextBytes;
  const textChunk = truncated ? chunk.subarray(0, maxTextBytes) : chunk;
  const validTextEncoding = looksTextual(textChunk);
  const textual = textExtensions.has(ext) || validTextEncoding;
  const lineWindow =
    textual && truncated && query.line
      ? await readTextLineWindow(target, query.line)
      : undefined;

  return {
    projectId: query.projectId,
    path: target,
    relativePath,
    name: basename(target),
    size: info.size,
    mtimeMs: info.mtimeMs,
    type: textual ? ("text" as const) : ("binary" as const),
    binary: !textual,
    text: textual
      ? (lineWindow?.text ?? textChunk.toString("utf8"))
      : undefined,
    lineStart: textual ? (lineWindow?.lineStart ?? 1) : undefined,
    targetLine: textual ? query.line : undefined,
    truncated,
    editable: textual && validTextEncoding && !truncated && editable,
    revision:
      textual && validTextEncoding && !truncated
        ? fileRevision(textChunk)
        : undefined,
  };
}

export async function saveFileContent(
  input: unknown,
  getProjectDirectory: (projectId: string) => string,
) {
  const parsed = filesystemFileSaveRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError(
      400,
      "INVALID_FILE_SAVE_REQUEST",
      "The file save request is invalid.",
    );
  }
  const request = parsed.data;
  if (Buffer.byteLength(request.text, "utf8") > maxTextBytes) {
    throw new ApplicationError(
      413,
      "FILE_TOO_LARGE",
      `File content exceeds the ${maxTextBytes} byte edit limit.`,
    );
  }

  try {
    const root = await realpath(
      resolve(getProjectDirectory(request.projectId)),
    );
    const target = resolveProjectFile(root, request.path.trim());
    if (!isInside(root, target)) {
      throw new ApplicationError(
        403,
        "FILE_PATH_OUTSIDE_PROJECT",
        "File path escapes the project.",
      );
    }

    await atomicWriteFile(target, request.text, {
      prepare: async (resolvedTarget) => {
        const linkInfo = await lstat(resolvedTarget);
        if (linkInfo.isSymbolicLink()) {
          throw new ApplicationError(
            400,
            "FILE_NOT_EDITABLE",
            "Symbolic links cannot be edited.",
          );
        }
        const targetRealPath = await realpath(resolvedTarget);
        if (!isInside(root, targetRealPath)) {
          throw new ApplicationError(
            403,
            "FILE_PATH_OUTSIDE_PROJECT",
            "File path escapes the project.",
          );
        }

        const info = await stat(targetRealPath);
        if (!info.isFile()) {
          throw new ApplicationError(
            400,
            "FILE_NOT_EDITABLE",
            `${targetRealPath} is not a regular file.`,
          );
        }
        if (info.size > maxTextBytes) {
          throw new ApplicationError(
            413,
            "FILE_TOO_LARGE",
            `File exceeds the ${maxTextBytes} byte edit limit.`,
          );
        }
        const current = await readFileChunk(targetRealPath, info.size);
        if (!looksTextual(current)) {
          throw new ApplicationError(
            400,
            "FILE_NOT_EDITABLE",
            "Binary or invalid UTF-8 files cannot be edited.",
          );
        }
        if (fileRevision(current) !== request.expectedRevision) {
          throw new ApplicationError(
            409,
            "FILE_REVISION_CONFLICT",
            "File changed on disk. Refresh it before saving.",
          );
        }
        return { mode: info.mode };
      },
    });

    return fileContent(
      { projectId: request.projectId, path: target },
      getProjectDirectory,
    );
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new ApplicationError(404, "FILE_NOT_FOUND", "File not found.");
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new ApplicationError(
        403,
        "FILE_PERMISSION_DENIED",
        "The file could not be written because permission was denied.",
      );
    }
    throw error;
  }
}

export { projectDirectoryEntries } from "./project-listing.js";
