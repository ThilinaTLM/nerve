import { closeSync, fstatSync, fsyncSync, openSync, renameSync } from "node:fs";
import { isRetriableRenameError } from "../../storage-bootstrap/file-mutations.js";

/** Filesystem primitives, injectable so the win32 branches are testable anywhere. */
export interface DurabilityDependencies {
  platform: NodeJS.Platform;
  open: typeof openSync;
  fsync: typeof fsyncSync;
  close: typeof closeSync;
  rename: typeof renameSync;
  sleep: (milliseconds: number) => void;
}

const defaults: DurabilityDependencies = {
  get platform() {
    return process.platform;
  },
  open: openSync,
  fsync: fsyncSync,
  close: closeSync,
  rename: renameSync,
  sleep: (milliseconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  },
};

const RENAME_ATTEMPTS = 5;
const INITIAL_RENAME_DELAY_MS = 10;

/**
 * Flush a file. Windows `FlushFileBuffers` needs write access, so files open
 * "r+" there; POSIX keeps "r" so read-only (0o444) files still sync. A Windows
 * file with the read-only attribute cannot be opened for writing: its flush is
 * skipped (the rename publish stays atomic).
 */
export function syncFile(
  path: string,
  dependencies: Partial<DurabilityDependencies> = {},
): void {
  const { platform, open, fsync, close } = { ...defaults, ...dependencies };
  const windows = platform === "win32";
  let fd: number;
  try {
    fd = open(path, windows ? "r+" : "r");
  } catch (error) {
    if (windows && isPermissionError(error) && isReadOnly(path)) return;
    throw error;
  }
  try {
    fsync(fd);
  } finally {
    close(fd);
  }
}

/** Directory sync is unsupported by Windows; file bytes are still synced there. */
export function syncDirectory(
  path: string,
  dependencies: Partial<DurabilityDependencies> = {},
): void {
  const { platform, open, fsync, close } = { ...defaults, ...dependencies };
  if (platform === "win32") return;
  const fd = open(path, "r");
  try {
    fsync(fd);
  } finally {
    close(fd);
  }
}

/** Rename with bounded backoff on Windows, where scanners briefly hold handles. */
export function renameWithRetrySync(
  from: string,
  to: string,
  dependencies: Partial<DurabilityDependencies> = {},
): void {
  const { platform, rename, sleep } = { ...defaults, ...dependencies };
  if (platform !== "win32") {
    rename(from, to);
    return;
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      if (!isRetriableRenameError(error) || attempt === RENAME_ATTEMPTS - 1) {
        throw error;
      }
      sleep(INITIAL_RENAME_DELAY_MS * 2 ** attempt);
    }
  }
}

function isPermissionError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EACCES";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isReadOnly(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    return (fstatSync(fd).mode & 0o200) === 0;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
