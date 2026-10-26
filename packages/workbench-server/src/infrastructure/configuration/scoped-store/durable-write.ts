import { open } from "node:fs/promises";
import path from "node:path";

export type DirectoryDurability = "synchronized" | "unsupported";

/** Rename durability needs a directory fsync in addition to the primitive's file fsync. */
export async function synchronizeDirectory(
  filePath: string,
): Promise<DirectoryDurability> {
  let directory;
  try {
    directory = await open(path.dirname(filePath), "r");
    await directory.sync();
    return "synchronized";
  } catch (error) {
    const code = errorCode(error);
    if (
      code === "EINVAL" ||
      code === "ENOTSUP" ||
      code === "EOPNOTSUPP" ||
      (process.platform === "win32" &&
        (code === "EPERM" || code === "EACCES" || code === "EISDIR"))
    )
      return "unsupported";
    throw error;
  } finally {
    await directory?.close();
  }
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
