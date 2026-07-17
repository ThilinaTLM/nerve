import { closeSync, rmSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, rm } from "node:fs/promises";
import path from "node:path";

export class StateLockConflictError extends Error {
  readonly exitCode = 12;
  constructor(readonly lockPath: string) {
    super(`Sandbox state lock is already held: ${lockPath}`);
    this.name = "StateLockConflictError";
  }
}

export class StateLock {
  private released = false;
  private readonly handleProcessExit = () => this.releaseSync();

  private constructor(
    private readonly handle: FileHandle,
    readonly lockPath: string,
  ) {
    // The process owns this lock for its entire lifetime. Keeping an exit
    // listener also keeps the FileHandle strongly referenced, preventing Node
    // from closing it during garbage collection and leaving a stale lock file.
    process.once("exit", this.handleProcessExit);
  }

  static async acquire(stateDir: string): Promise<StateLock> {
    const lockPath = path.join(stateDir, "lock");
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }),
      );
      await handle.sync().catch(() => undefined);
      return new StateLock(handle, lockPath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "EEXIST"
      ) {
        throw new StateLockConflictError(lockPath);
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    process.removeListener("exit", this.handleProcessExit);
    await this.handle.close().catch(() => undefined);
    await rm(this.lockPath, { force: true });
  }

  private releaseSync(): void {
    if (this.released) return;
    this.released = true;
    try {
      closeSync(this.handle.fd);
    } catch {
      // The descriptor may already have been closed during process teardown.
    }
    try {
      rmSync(this.lockPath, { force: true });
    } catch {
      // Process exit cannot await or recover from filesystem cleanup failures.
    }
  }
}
