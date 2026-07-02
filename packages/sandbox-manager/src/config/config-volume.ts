import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export async function writeConfigVolume(
  rootDir: string,
  sandboxId: string,
  yaml: string,
): Promise<string> {
  const dir = path.join(rootDir, sandboxId, "config");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "sandbox.yaml");
  await writeFile(file, yaml, "utf8");
  return file;
}
