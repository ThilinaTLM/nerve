import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The part of `node:test`'s `TestContext` the kit needs, so any context (or suite `after`) fits. */
export interface CleanupContext {
  after(fn: () => void | Promise<void>): void;
}

/** Removes a directory tree, retrying transient EBUSY/EPERM/ENOTEMPTY (Windows, still-closing handles). */
export function removeTree(path: string): Promise<void> {
  return rm(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

/** Creates a unique temp directory under the OS temp dir and removes it when the test ends. */
export async function makeTempDir(
  t: CleanupContext,
  prefix = "nerve-test-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => removeTree(directory));
  return directory;
}
