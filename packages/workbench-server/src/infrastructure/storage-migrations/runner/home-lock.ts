import { open, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { daemonFileSchema } from "@nervekit/contracts/status";

interface HomeLockDocument {
  format: "nerve-storage-migration-lock";
  version: 1;
  pid: number;
  token: string;
  acquiredAt: string;
}

export interface StorageHomeLock {
  path: string;
  release(): Promise<void>;
}

export class StorageHomeLockedError extends Error {
  readonly code = "STORAGE_HOME_LOCKED";

  constructor(message = "Nerve storage is owned by another live process.") {
    super(message);
    this.name = "StorageHomeLockedError";
  }
}

export async function acquireStorageHomeLock(
  home: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => Date;
    isProcessAlive?: (pid: number) => boolean;
  } = {},
): Promise<StorageHomeLock> {
  const path = `${home}.startup.lock`;
  const token = randomUUID();
  const now = options.now ?? (() => new Date());
  const alive = options.isProcessAlive ?? isProcessAlive;
  const deadline = now().getTime() + (options.timeoutMs ?? 10_000);
  const document: HomeLockDocument = {
    format: "nerve-storage-migration-lock",
    version: 1,
    pid: process.pid,
    token,
    acquiredAt: now().toISOString(),
  };

  while (true) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(document)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await assertNoLiveDaemon(home, alive);
      } catch (error) {
        await releaseOwnedLock(path, token);
        throw error;
      }
      return { path, release: () => releaseOwnedLock(path, token) };
    } catch (error) {
      if (error instanceof StorageHomeLockedError) throw error;
      if (errorCode(error) !== "EEXIST") throw error;
      const owner = await readLock(path);
      if (owner && !alive(owner.pid)) {
        // Removal is conditional on the token so a newly acquired lock cannot be
        // deleted after the stale lock was inspected.
        await releaseOwnedLock(path, owner.token);
        continue;
      }
      if (now().getTime() >= deadline) {
        throw new StorageHomeLockedError(
          owner
            ? `Nerve storage is locked by live process ${owner.pid}.`
            : "Nerve storage has an unreadable lock; remove it only after confirming no process owns the home.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 50));
    }
  }
}

async function assertNoLiveDaemon(
  home: string,
  alive: (pid: number) => boolean,
): Promise<void> {
  const value = await readJson(join(home, "daemon.json"));
  const parsed = daemonFileSchema.safeParse(value);
  if (
    parsed.success &&
    parsed.data.pid !== process.pid &&
    alive(parsed.data.pid)
  ) {
    throw new StorageHomeLockedError(
      `A live Nerve daemon (${parsed.data.pid}) is using this home.`,
    );
  }
}

async function readLock(path: string): Promise<HomeLockDocument | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    const legacyPid = Number(raw.trim());
    return Number.isInteger(legacyPid) && legacyPid > 0
      ? {
          format: "nerve-storage-migration-lock",
          version: 1,
          pid: legacyPid,
          token: `legacy:${raw.trim()}`,
          acquiredAt: new Date(0).toISOString(),
        }
      : undefined;
  }
  if (
    !value ||
    typeof value !== "object" ||
    (value as { format?: unknown }).format !== "nerve-storage-migration-lock" ||
    (value as { version?: unknown }).version !== 1 ||
    !Number.isInteger((value as { pid?: unknown }).pid) ||
    typeof (value as { token?: unknown }).token !== "string" ||
    typeof (value as { acquiredAt?: unknown }).acquiredAt !== "string"
  ) {
    return undefined;
  }
  return value as HomeLockDocument;
}

async function releaseOwnedLock(path: string, token: string): Promise<void> {
  const current = await readLock(path);
  if (current?.token === token) await rm(path, { force: true });
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
