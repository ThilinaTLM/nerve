import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteJson } from "../storage/json.js";
import { MigrationError } from "./migration.js";

const HEARTBEAT_INTERVAL_MS = 2_000;
const STALE_LEASE_MS = 30_000;

interface LockOwner {
  pid: number;
  host: string;
  token: string;
  startedAt: string;
  heartbeatAt: string;
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
  const now = new Date().toISOString();
  const owner: LockOwner = {
    pid: process.pid,
    host: hostname(),
    token: randomBytes(16).toString("hex"),
    startedAt: now,
    heartbeatAt: now,
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
      const heartbeat = setInterval(() => {
        void refreshHeartbeat(path, owner).catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      return {
        release: async () => {
          clearInterval(heartbeat);
          const current = await readOwner(path);
          if (current?.token === owner.token) await rm(path, { force: true });
        },
      };
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

async function refreshHeartbeat(path: string, owner: LockOwner): Promise<void> {
  const current = await readOwner(path);
  if (current?.token !== owner.token) return;
  owner.heartbeatAt = new Date().toISOString();
  await atomicWriteJson(path, owner, 0o600);
}

async function removeStaleLock(path: string): Promise<boolean> {
  const owner = await readOwner(path);
  if (!owner) {
    await rm(path, { force: true });
    return true;
  }
  const heartbeat = Date.parse(owner.heartbeatAt);
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > STALE_LEASE_MS) {
    await removeOwnedLock(path, owner.token);
    return true;
  }
  if (owner.host !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (errorCode(error) === "EPERM") return false;
    await removeOwnedLock(path, owner.token);
    return true;
  }
}

async function removeOwnedLock(path: string, token: string): Promise<void> {
  const current = await readOwner(path);
  if (current?.token === token) await rm(path, { force: true });
}

async function readOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const value = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<LockOwner>;
    return typeof value.pid === "number" &&
      typeof value.host === "string" &&
      typeof value.token === "string" &&
      typeof value.startedAt === "string" &&
      typeof value.heartbeatAt === "string"
      ? (value as LockOwner)
      : undefined;
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
