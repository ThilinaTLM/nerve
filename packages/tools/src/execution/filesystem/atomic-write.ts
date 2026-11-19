import {
  chmod,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200];

/** Replace the file's content via temp file + rename, keeping symlinks and mode. */
export async function writeTextFileAtomically(
  path: string,
  content: string,
): Promise<void> {
  const target = await realpath(path).catch(() => path);
  const mode = await stat(target).then(
    (info) => info.mode & 0o7777,
    () => undefined,
  );
  const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, content, "utf8");
    if (mode !== undefined) await chmod(tempPath, mode);
    await renameWithRetry(tempPath, target);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (
        process.platform !== "win32" ||
        delay === undefined ||
        !code ||
        !RENAME_RETRY_CODES.has(code)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
