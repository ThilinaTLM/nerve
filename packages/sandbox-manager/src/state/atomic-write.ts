import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

let atomicWriteCounter = 0;
const fileQueues = new Map<string, Promise<void>>();

export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  mode?: number,
): Promise<void> {
  const resolved = path.resolve(filePath);
  const previous = fileQueues.get(resolved) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => atomicWriteFileUnqueued(resolved, data, mode));
  const queued = next
    .catch(() => undefined)
    .finally(() => {
      if (fileQueues.get(resolved) === queued) fileQueues.delete(resolved);
    });
  fileQueues.set(resolved, queued);
  await next;
}

export function isNotFound(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

async function atomicWriteFileUnqueued(
  filePath: string,
  data: string | Buffer,
  mode?: number,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = tempFilePath(filePath);
  let cleanup = true;
  try {
    const handle = await open(tmp, "wx", mode);
    try {
      await handle.writeFile(data);
      await handle.sync().catch(() => undefined);
    } finally {
      await handle.close();
    }
    await retryRename(tmp, filePath);
    cleanup = false;
  } finally {
    if (cleanup) await rm(tmp, { force: true }).catch(() => undefined);
  }
}

function tempFilePath(filePath: string): string {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${++atomicWriteCounter}.${randomBytes(4).toString("hex")}.tmp`,
  );
}

async function retryRename(source: string, target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableRenameError(error)) throw error;
      await delay(10 * 2 ** attempt);
    }
  }
  throw lastError;
}

function isRetriableRenameError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
