import { createReadStream } from "node:fs";
import {
  access,
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
  isAbsolute,
  join,
  parse,
  posix,
  relative,
  resolve,
  win32,
} from "node:path";
import { createInterface } from "node:readline";
import {
  clipboardImageUploadRequestSchema,
  type FilesystemProjectEntry,
  type FilesystemSignal,
  filesystemFileQuerySchema,
  filesystemProjectEntriesQuerySchema,
  filesystemProjectEntryCreateRequestSchema,
} from "@nervekit/contracts";
import { storagePaths } from "../../infrastructure/storage/paths.js";

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

async function mapBatched<T, U>(
  values: T[],
  batchSize: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + batchSize).map(mapper),
      )),
    );
  }
  return results;
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
    : "clipboard-image";
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "clipboard-image"
  );
}

function timestampSlug(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function saveClipboardImage(input: unknown, storageHome: string) {
  const request = clipboardImageUploadRequestSchema.parse(input);
  const type = request.type.toLowerCase();
  const ext = imageExtensionByMime.get(type);
  if (!ext)
    throw new Error(`Unsupported clipboard image type: ${request.type}`);

  const dir = storagePaths(storageHome).imagesPath;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = join(
    dir,
    `${slugifyName(request.name)}-${timestampSlug()}.${ext}`,
  );
  await writeFile(filePath, Buffer.from(request.dataBase64, "base64"), {
    flag: "wx",
  });
  return { path: filePath };
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
    .filter((entry) => showHidden || !entry.name.startsWith("."))
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
        hidden: entry.name.startsWith("."),
        signals: await detectDirectorySignals(entryPath),
      };
    }),
  };
}

const defaultProjectEntryLimit = 500;

type ProjectEntrySortKey = [number, string, string, string];

function normalizeProjectRelativeDirectory(
  rawPath: string | undefined,
): string {
  const path = rawPath?.trim().replaceAll("\\", "/") ?? "";
  if (!path) return "";
  if (path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:\//.test(path))
    throw new Error("Project directory path must be relative.");
  const segments = path.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error("Project directory path contains an invalid segment.");
  return segments.join("/");
}

function projectEntrySortKey(
  entry: FilesystemProjectEntry,
): ProjectEntrySortKey {
  return [
    entry.kind === "directory" ? 0 : entry.kind === "file" ? 1 : 2,
    entry.name.toLocaleLowerCase(),
    entry.name,
    entry.path,
  ];
}

function compareProjectEntryKeys(
  left: ProjectEntrySortKey,
  right: ProjectEntrySortKey,
): number {
  return (
    left[0] - right[0] ||
    left[1].localeCompare(right[1], undefined, { numeric: true }) ||
    left[2].localeCompare(right[2], undefined, { numeric: true }) ||
    left[3].localeCompare(right[3])
  );
}

function encodeProjectEntryCursor(
  path: string,
  key: ProjectEntrySortKey,
): string {
  return Buffer.from(JSON.stringify({ path, key })).toString("base64url");
}

function decodeProjectEntryCursor(
  cursor: string,
  path: string,
): ProjectEntrySortKey {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      path?: unknown;
      key?: unknown;
    };
    if (
      decoded.path !== path ||
      !Array.isArray(decoded.key) ||
      decoded.key.length !== 4 ||
      typeof decoded.key[0] !== "number" ||
      decoded.key.slice(1).some((value) => typeof value !== "string")
    )
      throw new Error("invalid");
    return decoded.key as ProjectEntrySortKey;
  } catch {
    throw new Error("Invalid or stale project directory cursor.");
  }
}

async function classifyProjectEntry(
  root: string,
  directory: string,
  relativeDirectory: string,
  entry: import("node:fs").Dirent,
): Promise<FilesystemProjectEntry> {
  const path = relativeDirectory
    ? `${relativeDirectory}/${entry.name}`
    : entry.name;
  if (!entry.isSymbolicLink()) {
    return {
      name: entry.name,
      path,
      kind: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other",
      symlink: false,
    };
  }

  let kind: FilesystemProjectEntry["kind"] = "other";
  try {
    const target = await realpath(join(directory, entry.name));
    if (isInside(root, target)) {
      const info = await stat(target);
      kind = info.isDirectory()
        ? "directory"
        : info.isFile()
          ? "file"
          : "other";
    }
  } catch {
    // Broken and inaccessible links stay visible as non-browsable entries.
  }
  return { name: entry.name, path, kind, symlink: true };
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

export async function projectDirectoryEntries(
  input: unknown,
  getProjectDirectory: (projectId: string) => string,
) {
  const query = filesystemProjectEntriesQuerySchema.parse(input);
  const relativeDirectory = normalizeProjectRelativeDirectory(query.path);
  const root = await realpath(resolve(getProjectDirectory(query.projectId)));
  const directory = resolve(root, relativeDirectory);
  if (!isInside(root, directory))
    throw new Error("Project directory path escapes the project root.");

  const resolvedDirectory = await realpath(directory);
  if (!isInside(root, resolvedDirectory))
    throw new Error("Project directory path escapes the project root.");
  const info = await stat(resolvedDirectory);
  if (!info.isDirectory())
    throw new Error(`${relativeDirectory || "."} is not a directory.`);

  const entries = await mapBatched(
    await readdir(resolvedDirectory, { withFileTypes: true }),
    32,
    (entry) =>
      classifyProjectEntry(root, resolvedDirectory, relativeDirectory, entry),
  );
  entries.sort((left, right) =>
    compareProjectEntryKeys(
      projectEntrySortKey(left),
      projectEntrySortKey(right),
    ),
  );

  let start = 0;
  if (query.cursor) {
    const cursorKey = decodeProjectEntryCursor(query.cursor, relativeDirectory);
    const cursorIndex = entries.findIndex(
      (entry) =>
        compareProjectEntryKeys(projectEntrySortKey(entry), cursorKey) === 0,
    );
    if (cursorIndex < 0)
      throw new Error("Invalid or stale project directory cursor.");
    start = cursorIndex + 1;
  }

  const limit = query.limit ?? defaultProjectEntryLimit;
  const page = entries.slice(start, start + limit);
  const last = page.at(-1);
  return {
    projectId: query.projectId,
    path: relativeDirectory,
    entries: page,
    nextCursor:
      last && start + page.length < entries.length
        ? encodeProjectEntryCursor(relativeDirectory, projectEntrySortKey(last))
        : undefined,
  };
}

const maxTextBytes = 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const lineWindowBefore = 200;
const lineWindowAfter = 800;

const imageMimeByExtension = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
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
  ".env",
  ".go",
  ".h",
  ".html",
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
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function normalizeIncomingFilePath(
  root: string,
  rawPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  let path = rawPath.trim();

  if (path.toLowerCase().startsWith("file://")) {
    try {
      const url = new URL(path);
      const decoded = decodeURIComponent(url.pathname);
      path = url.hostname ? `//${url.hostname}${decoded}` : decoded;
      path = path.replace(/^\/([A-Za-z]:\/)/, "$1");
    } catch {
      // Leave malformed file URLs to the normal resolver/stat error path.
    }
  }

  if (platform === "win32") {
    const msys = path.match(/^\/([A-Za-z])(?:\/|$)(.*)$/);
    const wsl = path.match(/^\/mnt\/([A-Za-z])(?:\/|$)(.*)$/);
    const drive = wsl ?? msys;
    if (drive) {
      const [, letter, rest = ""] = drive;
      path = `${letter?.toUpperCase()}:/${rest}`;
    }

    if (!path.startsWith("//")) path = path.replaceAll("/", "\\");
  }

  const pathApi = platform === "win32" ? win32 : posix;
  return pathApi.isAbsolute(path)
    ? pathApi.resolve(path)
    : pathApi.resolve(root, path);
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
  const info = await stat(target);
  if (info.isDirectory()) throw new Error(`${target} is a directory.`);

  const relativePath = (
    isInside(root, target) ? relative(root, target) : target
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
    };
  }

  const readBytes = Math.min(info.size, maxTextBytes + 1);
  const chunk = await readFileChunk(target, readBytes);
  const truncated = info.size > maxTextBytes;
  const textChunk = truncated ? chunk.subarray(0, maxTextBytes) : chunk;
  const textual = textExtensions.has(ext) || looksTextual(textChunk);
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
  };
}
