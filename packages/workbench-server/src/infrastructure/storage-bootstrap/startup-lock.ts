import { open, rm, stat } from "node:fs/promises";

const STALE_MS = 30_000;

export interface StorageStartupLock {
  release(): Promise<void>;
}

/** Serialize first-run creation without placing an unmanifested file in home. */
export async function acquireStorageStartupLock(
  home: string,
  timeoutMs = 10_000,
): Promise<StorageStartupLock> {
  const path = `${home}.startup.lock`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.sync();
      await handle.close();
      return { release: () => rm(path, { force: true }) };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const info = await stat(path).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > STALE_MS) {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Nerve home initialization is locked by another process.",
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
