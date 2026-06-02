import { rename, writeFile } from "node:fs/promises";

export async function writeTextFileAtomically(
  path: string,
  content: string,
): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}
