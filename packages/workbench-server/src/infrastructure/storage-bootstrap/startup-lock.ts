import { acquireStorageHomeLock, type StorageHomeLock } from "./home-lock.js";

export type StorageStartupLock = StorageHomeLock;

/**
 * Serialize home initialization and migration. Locks are reclaimed only when
 * their owning PID is no longer alive; elapsed time alone never steals a lock.
 */
export function acquireStorageStartupLock(
  home: string,
  timeoutMs = 10_000,
): Promise<StorageStartupLock> {
  return acquireStorageHomeLock(home, { timeoutMs });
}
