import {
  access,
  mkdir,
  open,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import {
  clipboardImageUploadRequestSchema,
  type FilesystemSignal,
  filesystemDirectoryQuerySchema,
  filesystemFileQuerySchema,
} from "@nerve/shared";
import { Hono } from "hono";
import { routeHandler } from "../http/responses.js";
import type { OrchestratorState } from "../server.js";

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

async function saveClipboardImage(input: unknown) {
  const request = clipboardImageUploadRequestSchema.parse(input);
  const type = request.type.toLowerCase();
  const ext = imageExtensionByMime.get(type);
  if (!ext)
    throw new Error(`Unsupported clipboard image type: ${request.type}`);

  const dir = join(tmpdir(), "nerve");
  await mkdir(dir, { recursive: true });
  const filePath = join(
    dir,
    `${slugifyName(request.name)}-${timestampSlug()}.${ext}`,
  );
  await writeFile(filePath, Buffer.from(request.dataBase64, "base64"), {
    flag: "wx",
  });
  return { path: filePath };
}

async function directoryListing(path: string | undefined, showHidden = false) {
  const target = resolve(path?.trim() || process.env.HOME || tmpdir());
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

const maxTextBytes = 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;

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

function resolveProjectFile(root: string, rawPath: string): string {
  const path = rawPath.trim();
  return isAbsolute(path) ? resolve(path) : resolve(root, path);
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

async function fileContent(state: OrchestratorState, input: unknown) {
  const query = filesystemFileQuerySchema.parse(input);
  const project = state.registry.getProject(query.projectId);
  const root = resolve(project.dir);
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

  return {
    projectId: query.projectId,
    path: target,
    relativePath,
    name: basename(target),
    size: info.size,
    mtimeMs: info.mtimeMs,
    type: textual ? ("text" as const) : ("binary" as const),
    binary: !textual,
    text: textual ? textChunk.toString("utf8") : undefined,
    truncated,
  };
}

export function createFilesystemRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.get(
    "/filesystem/directories",
    routeHandler(async (c) => {
      const query = filesystemDirectoryQuerySchema.parse({
        path: c.req.query("path"),
        showHidden: c.req.query("showHidden"),
      });
      return c.json(await directoryListing(query.path, query.showHidden));
    }),
  );

  app.get(
    "/filesystem/file",
    routeHandler(async (c) =>
      c.json(
        await fileContent(state, {
          projectId: c.req.query("projectId"),
          path: c.req.query("path"),
          line: c.req.query("line"),
        }),
      ),
    ),
  );

  app.post(
    "/filesystem/clipboard-image",
    routeHandler(async (c) =>
      c.json(await saveClipboardImage(await c.req.json())),
    ),
  );

  return app;
}
