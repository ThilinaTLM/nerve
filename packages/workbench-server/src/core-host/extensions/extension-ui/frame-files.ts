import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** What a frame may load, by file extension. No `.wasm`, `.map` or `.txt`: the CSP does not allow what they are for. */
export const frameMimeTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/** Largest file a frame can load. */
export const maxFrameFileBytes = 10 * 1024 * 1024;

const contained = (root: string, target: string) => {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
};

/** The path of a request inside a frame folder, normalized, or `undefined` when it is not a plain relative path. */
export function framePath(requested: string): string | undefined {
  if (requested.includes("\0") || requested.includes("\\")) return undefined;
  const parts: string[] = [];
  for (const part of requested.split("/")) {
    if (part === "..") return undefined;
    if (part && part !== ".") parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : "index.html";
}

export type FrameFile = { body: Uint8Array<ArrayBuffer>; mime: string };

/**
 * Reads one file below `root` for a frame: the resolved and opened file must stay inside `root`
 * (symbolic links included), have an allowed type and fit the size limit. `undefined` for
 * anything else, so a refusal never says why.
 */
export async function readContainedFile(
  root: string,
  path: string,
  options: {
    allowed?: Readonly<Record<string, string>>;
    maxBytes?: number;
  } = {},
): Promise<FrameFile | undefined> {
  const types = options.allowed ?? frameMimeTypes;
  const maxBytes = options.maxBytes ?? maxFrameFileBytes;
  const mime = types[extname(path).toLowerCase()];
  if (!mime) return undefined;
  try {
    const real = await realpath(root);
    const requested = resolve(real, path);
    const target = await realpath(requested);
    if (
      !contained(real, target) ||
      types[extname(target).toLowerCase()] !== mime
    )
      return undefined;
    const file = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const [opened, current] = await Promise.all([file.stat(), stat(target)]);
      if (
        !opened.isFile() ||
        opened.size > maxBytes ||
        opened.dev !== current.dev ||
        opened.ino !== current.ino ||
        (await realpath(requested)) !== target
      )
        return undefined;
      const buffer = Buffer.alloc(Math.min(opened.size + 1, maxBytes + 1));
      let read = 0;
      while (read < buffer.length) {
        const result = await file.read(
          buffer,
          read,
          buffer.length - read,
          read,
        );
        if (!result.bytesRead) break;
        read += result.bytesRead;
      }
      if (read > maxBytes) return undefined;
      return { body: new Uint8Array(buffer.subarray(0, read)), mime };
    } finally {
      await file.close();
    }
  } catch {
    return undefined;
  }
}

/** The folder of a frame: `<dist>/ui/<contribution>`. */
export const frameFolder = (dist: string, contribution: string) =>
  join(dist, "ui", contribution);
