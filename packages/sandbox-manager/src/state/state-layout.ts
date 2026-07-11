import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const marker = { format: "nerve-sandbox-manager-state", version: 1 } as const;

export async function ensureManagerStateLayout(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  const markerPath = path.join(rootDir, "VERSION");
  try {
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as {
      format?: unknown;
      version?: unknown;
    };
    if (parsed.format === marker.format && parsed.version === marker.version)
      return;
    throw new Error("incompatible marker");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw incompatible(rootDir, error);
    }
  }
  if ((await readdir(rootDir)).length > 0) throw incompatible(rootDir);
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
}

function incompatible(rootDir: string, cause?: unknown): Error {
  return new Error(
    `Incompatible sandbox manager state at ${rootDir}. Reset this directory before starting Nerve Protocol v1.`,
    { cause },
  );
}
