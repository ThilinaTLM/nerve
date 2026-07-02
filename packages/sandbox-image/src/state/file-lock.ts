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
  private constructor(
    private readonly handle: FileHandle,
    readonly lockPath: string,
  ) {}

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
    await this.handle.close().catch(() => undefined);
    await rm(this.lockPath, { force: true });
  }
}
