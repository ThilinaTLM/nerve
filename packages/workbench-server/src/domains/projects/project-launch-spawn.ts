import type { ChildProcess } from "node:child_process";
import { once } from "node:events";

/** Detach only after the OS has accepted the launch; `once` rejects on error. */
export async function unrefSpawnedProjectLauncher(
  child: ChildProcess,
): Promise<void> {
  await once(child, "spawn");
  child.unref();
}
