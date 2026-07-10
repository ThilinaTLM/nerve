import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface SizeTally {
  bytes: number;
  files: number;
}

export async function dirSize(path: string): Promise<SizeTally> {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await dirSize(child);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += await fileSize(child);
      files += 1;
    }
  }
  return { bytes, files };
}

export async function fileSize(path: string): Promise<number> {
  return stat(path)
    .then((value) => (value.isFile() ? value.size : 0))
    .catch(() => 0);
}
