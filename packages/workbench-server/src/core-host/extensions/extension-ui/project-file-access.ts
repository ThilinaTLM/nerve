import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  bridgeLimits,
  type BridgeResult,
} from "@nervekit/contracts/extensions";
import { atomicWriteFile } from "../../../infrastructure/storage-bootstrap/file-mutations.js";
import { ExtensionUiError } from "./extension-ui-error.js";

/*
 * The file a preview is opened on, for the bridge's `file.*` methods. Every access resolves the
 * path again, requires it to stay inside the project (symbolic links included) and to be a
 * regular file. Writes replace the file atomically and keep its mode.
 */

type ProjectFile = {
  /** Real path of the file. */
  real: string;
  /** Project-relative path, `/` separated. */
  path: string;
};

async function locate(
  directory: string,
  filePath: string,
): Promise<ProjectFile> {
  if (filePath.includes("\0"))
    throw new ExtensionUiError("invalid_request", "Invalid file path.");
  let root: string;
  try {
    root = await realpath(directory);
  } catch {
    throw new ExtensionUiError(
      "not_found",
      "The project folder is unavailable.",
    );
  }
  let real: string;
  try {
    real = await realpath(resolve(root, filePath));
  } catch {
    throw new ExtensionUiError("not_found", "The file does not exist.");
  }
  const rel = relative(root, real);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  )
    throw new ExtensionUiError("not_found", "The file is outside the project.");
  return { real, path: rel.split(sep).join("/") };
}

export async function fileInfo(
  directory: string,
  filePath: string,
): Promise<BridgeResult<"file.info">> {
  const file = await locate(directory, filePath);
  const info = await stat(file.real);
  if (!info.isFile())
    throw new ExtensionUiError("not_found", "Not a regular file.");
  return {
    path: file.path,
    name: basename(file.real),
    extension: extname(file.real).toLowerCase(),
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
  };
}

export async function readFileRange(
  directory: string,
  filePath: string,
  range: { offset?: number; length?: number },
): Promise<BridgeResult<"file.read">> {
  const file = await locate(directory, filePath);
  const handle = await open(
    file.real,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  ).catch(() => {
    throw new ExtensionUiError("not_found", "The file cannot be opened.");
  });
  try {
    const info = await handle.stat();
    if (!info.isFile())
      throw new ExtensionUiError("not_found", "Not a regular file.");
    const offset = range.offset ?? 0;
    const length = Math.min(
      range.length ?? bridgeLimits.defaultReadChunkBytes,
      bridgeLimits.maxReadChunkBytes,
      Math.max(0, info.size - offset),
    );
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const result = await handle.read(
        buffer,
        read,
        length - read,
        offset + read,
      );
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    return {
      offset,
      dataBase64: buffer.subarray(0, read).toString("base64"),
      length: read,
      size: info.size,
      eof: offset + read >= info.size,
    };
  } finally {
    await handle.close();
  }
}

export async function writeFileContent(
  directory: string,
  filePath: string,
  content: string,
  encoding: "utf8" | "base64",
): Promise<BridgeResult<"file.write">> {
  const bytes =
    encoding === "base64"
      ? Buffer.from(content, "base64")
      : Buffer.from(content, "utf8");
  if (bytes.byteLength > bridgeLimits.maxWriteBytes)
    throw new ExtensionUiError(
      "too_large",
      `A write is limited to ${bridgeLimits.maxWriteBytes} bytes.`,
    );
  const file = await locate(directory, filePath);
  const info = await stat(file.real);
  if (!info.isFile())
    throw new ExtensionUiError("not_found", "Not a regular file.");
  try {
    await atomicWriteFile(file.real, bytes, { mode: info.mode & 0o7777 });
  } catch (cause) {
    throw new ExtensionUiError(
      "failed",
      `The file could not be written: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return { size: bytes.byteLength };
}
