import { hostname } from "node:os";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { MigrationError } from "./migration.js";

interface LockOwner {
  pid: number;
  host: string;
  startedAt: string;
}

export interface MigrationLock {
  release(): Promise<void>;
}

export async function acquireMigrationLock(
  path: string,
  timeoutMs = 10_000,
): Promise<MigrationLock> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  const owner: LockOwner = {
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
  };
  while (true) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { release: () => rm(path, { force: true }) };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (await removeStaleLock(path)) continue;
      if (Date.now() >= deadline) {
        throw new MigrationError(
          "Storage migrations are locked by a live Nerve process. Stop the daemon and retry.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function removeStaleLock(path: string): Promise<boolean> {
  let owner: LockOwner;
  try {
    owner = JSON.parse(await readFile(path, "utf8")) as LockOwner;
  } catch {
    await rm(path, { force: true });
    return true;
  }
  if (owner.host !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (errorCode(error) === "EPERM") return false;
    await rm(path, { force: true });
    return true;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
