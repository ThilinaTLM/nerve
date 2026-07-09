import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export async function materializeSecretFile(
  rootDir: string,
  name: string,
  value: string,
): Promise<string> {
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  const file = path.join(rootDir, name.replace(/[^a-zA-Z0-9_.-]/g, "_"));
  await writeFile(file, value, { encoding: "utf8", mode: 0o600 });
  return file;
}
