import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

let atomicWriteCounter = 0;
const atomicWriteQueues = new Map<string, Promise<void>>();

export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  mode?: number,
): Promise<void> {
  const resolved = path.resolve(filePath);
  const previous = atomicWriteQueues.get(resolved) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => atomicWriteFileUnqueued(resolved, data, mode));
  const queued = next
    .catch(() => undefined)
    .finally(() => {
      if (atomicWriteQueues.get(resolved) === queued)
        atomicWriteQueues.delete(resolved);
    });
  atomicWriteQueues.set(resolved, queued);
  await next;
}

async function atomicWriteFileUnqueued(
  filePath: string,
  data: string | Buffer,
  mode?: number,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = await createTempFilePath(filePath);
  let shouldCleanup = true;
  try {
    const handle = await open(tmp, "wx", mode);
    try {
      await handle.writeFile(data);
      await handle.sync().catch(() => undefined);
    } finally {
      await handle.close();
    }
    await retryRename(tmp, filePath);
    shouldCleanup = false;
  } finally {
    if (shouldCleanup) await rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function createTempFilePath(filePath: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tmp = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${++atomicWriteCounter}.${randomBytes(4).toString("hex")}.tmp`,
    );
    try {
      const handle = await open(tmp, "wx");
      await handle.close();
      await rm(tmp, { force: true });
      return tmp;
    } catch (error) {
      if (!isRetriableTempCollision(error)) throw error;
    }
  }
  throw new Error(`Unable to allocate temp file for ${filePath}`);
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

function isRetriableTempCollision(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
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

export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly schema?: { parse(value: unknown): T },
  ) {}

  async read(defaultValue: T): Promise<T> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return this.schema ? this.schema.parse(parsed) : (parsed as T);
    } catch (error) {
      if (isNotFound(error)) return defaultValue;
      throw error;
    }
  }

  async write(value: T, mode?: number): Promise<void> {
    const parsed = this.schema ? this.schema.parse(value) : value;
    await atomicWriteFile(
      this.filePath,
      `${JSON.stringify(parsed, null, 2)}\n`,
      mode,
    );
  }
}

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
