import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

const RENAME_ATTEMPTS = 8;
const INITIAL_RENAME_DELAY_MS = 10;

let temporaryFileCounter = 0;
const fileMutationQueues = new Map<string, Promise<void>>();

export interface RenameRetryObservation {
  readonly attempt: number;
  readonly delayMs: number;
}

export interface RenameDependencies {
  readonly rename?: (source: string, target: string) => Promise<void>;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly onRenameRetry?: (observation: RenameRetryObservation) => void;
}

/**
 * How far an atomic write is made durable before it is reported done.
 * - `none`: no fsync. Rebuildable caches and indexes.
 * - `file` (default): fsync the temporary file before the rename.
 * - `directory`: also fsync the parent directory so the rename survives power loss.
 *   Configuration, credentials and tokens.
 */
export type WriteDurability = "none" | "file" | "directory";

export interface AtomicReplaceOptions extends RenameDependencies {
  readonly mode?: number;
  readonly durability?: WriteDurability;
  readonly prepare?: (
    resolvedPath: string,
  ) => Promise<{ mode?: number } | undefined>;
  readonly onFsync?: () => void;
}

export async function withFileMutation<T>(
  filePath: string,
  mutation: (resolvedPath: string) => Promise<T>,
): Promise<T> {
  const resolvedPath = path.resolve(filePath);
  const previous = fileMutationQueues.get(resolvedPath) ?? Promise.resolve();
  const result = previous
    .catch(() => undefined)
    .then(() => mutation(resolvedPath));
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  fileMutationQueues.set(resolvedPath, tail);
  try {
    return await result;
  } finally {
    if (fileMutationQueues.get(resolvedPath) === tail) {
      fileMutationQueues.delete(resolvedPath);
    }
  }
}

export function atomicReplaceFile(
  filePath: string,
  writeTemporary: (handle: FileHandle) => Promise<void>,
  options: AtomicReplaceOptions = {},
): Promise<void> {
  return withFileMutation(filePath, async (resolvedPath) => {
    const prepared = await options.prepare?.(resolvedPath);
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    const temporary = temporaryFilePath(resolvedPath);
    let temporaryCreated = false;
    let replacementCompleted = false;
    try {
      const handle = await open(
        temporary,
        "wx",
        prepared?.mode ?? options.mode,
      );
      temporaryCreated = true;
      try {
        await writeTemporary(handle);
        if (options.durability !== "none") {
          await handle.sync();
          options.onFsync?.();
        }
      } finally {
        await handle.close();
      }
      await retryRename(temporary, resolvedPath, options);
      replacementCompleted = true;
      if (options.durability === "directory")
        await synchronizeDirectory(resolvedPath);
    } finally {
      if (temporaryCreated && !replacementCompleted) {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }
  });
}

export function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options: AtomicReplaceOptions = {},
): Promise<void> {
  return atomicReplaceFile(
    filePath,
    async (handle) => {
      await handle.writeFile(data);
    },
    options,
  );
}

/** Synchronous sibling of {@link atomicWriteFile} for crash and shutdown paths. No queueing or rename retry. */
export function atomicWriteFileSync(
  filePath: string,
  data: string | Buffer,
  options: Pick<AtomicReplaceOptions, "mode" | "durability"> & {
    readonly directoryMode?: number;
  } = {},
): void {
  const resolvedPath = path.resolve(filePath);
  mkdirSync(path.dirname(resolvedPath), {
    recursive: true,
    ...(options.directoryMode === undefined
      ? {}
      : { mode: options.directoryMode }),
  });
  const temporary = temporaryFilePath(resolvedPath);
  let replaced = false;
  try {
    const fd = openSync(temporary, "wx", options.mode);
    try {
      writeFileSync(fd, data);
      if (options.durability !== "none") fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, resolvedPath);
    replaced = true;
  } finally {
    if (!replaced) rmSync(temporary, { force: true });
  }
}

export async function retryRename(
  source: string,
  target: string,
  dependencies: RenameDependencies = {},
): Promise<void> {
  const renameFile = dependencies.rename ?? rename;
  const wait = dependencies.delay ?? delay;
  let lastError: unknown;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      await renameFile(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetriableRenameError(error) || attempt === RENAME_ATTEMPTS - 1) {
        throw error;
      }
      const delayMs = INITIAL_RENAME_DELAY_MS * 2 ** attempt;
      try {
        dependencies.onRenameRetry?.({ attempt: attempt + 1, delayMs });
      } catch {
        // Diagnostics must never affect file replacement.
      }
      await wait(delayMs);
    }
  }
  throw lastError;
}

export function isRetriableRenameError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function temporaryFilePath(filePath: string): string {
  temporaryFileCounter += 1;
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${temporaryFileCounter}.${randomBytes(4).toString("hex")}.tmp`,
  );
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export type DirectoryDurability = "synchronized" | "unsupported";

/** Rename durability needs a directory fsync in addition to the file fsync. */
export async function synchronizeDirectory(
  filePath: string,
): Promise<DirectoryDurability> {
  let directory;
  try {
    directory = await open(path.dirname(filePath), "r");
    await directory.sync();
    return "synchronized";
  } catch (error) {
    const code = errorCode(error);
    if (
      code === "EINVAL" ||
      code === "ENOTSUP" ||
      code === "EOPNOTSUPP" ||
      (process.platform === "win32" &&
        (code === "EPERM" || code === "EACCES" || code === "EISDIR"))
    )
      return "unsupported";
    throw error;
  } finally {
    await directory?.close();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
