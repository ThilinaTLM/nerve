import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, parse, resolve } from "node:path";
import {
  clipboardImageUploadRequestSchema,
  type FilesystemSignal,
  filesystemDirectoryQuerySchema,
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
  const base = name?.trim() ? name.trim().replace(extname(name.trim()), "") : "clipboard-image";
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "clipboard-image";
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function saveClipboardImage(input: unknown) {
  const request = clipboardImageUploadRequestSchema.parse(input);
  const type = request.type.toLowerCase();
  const ext = imageExtensionByMime.get(type);
  if (!ext) throw new Error(`Unsupported clipboard image type: ${request.type}`);

  const dir = join(tmpdir(), "nerve");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${slugifyName(request.name)}-${timestampSlug()}.${ext}`);
  await writeFile(filePath, Buffer.from(request.dataBase64, "base64"), { flag: "wx" });
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

export function createFilesystemRoutes(_state: OrchestratorState): Hono {
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

  app.post(
    "/filesystem/clipboard-image",
    routeHandler(async (c) => c.json(await saveClipboardImage(await c.req.json()))),
  );

  return app;
}
