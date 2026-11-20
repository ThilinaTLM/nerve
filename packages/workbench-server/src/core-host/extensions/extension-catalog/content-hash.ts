import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Hash of what an installed extension runs and declares: every file under `dist/` (which holds
 * `manifest.json`), in a stable order, by relative path and content.
 */
export async function hashExtensionContent(folder: string): Promise<string> {
  const dist = join(folder, "dist");
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(path);
    }
  };
  await walk(dist);
  const hash = createHash("sha256");
  for (const file of files
    .map((path) => relative(dist, path).split("\\").join("/"))
    .sort()) {
    const path = join(dist, file);
    // A link to a directory or a missing target hashes as its name only.
    const content = (await stat(path).catch(() => undefined))?.isFile()
      ? await readFile(path)
      : Buffer.alloc(0);
    hash.update(`${file}\0${content.length}\0`).update(content).update("\0");
  }
  return hash.digest("hex");
}
