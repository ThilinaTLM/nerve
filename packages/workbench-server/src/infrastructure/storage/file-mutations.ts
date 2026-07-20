import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

const RENAME_ATTEMPTS = 8;
const INITIAL_RENAME_DELAY_MS = 10;

let temporaryFileCounter = 0;
const fileMutationQueues = new Map<string, Promise<void>>();

export interface RenameDependencies {
  readonly rename?: (source: string, target: string) => Promise<void>;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

export interface AtomicReplaceOptions extends RenameDependencies {
  readonly mode?: number;
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
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    const temporary = temporaryFilePath(resolvedPath);
    let temporaryCreated = false;
    let replacementCompleted = false;
    try {
      const handle = await open(temporary, "wx", options.mode);
      temporaryCreated = true;
      try {
        await writeTemporary(handle);
        await handle.sync();
        options.onFsync?.();
      } finally {
        await handle.close();
      }
      await retryRename(temporary, resolvedPath, options);
      replacementCompleted = true;
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
      await wait(INITIAL_RENAME_DELAY_MS * 2 ** attempt);
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

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
