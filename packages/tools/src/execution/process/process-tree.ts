import type { ChildProcess } from "node:child_process";
import { managedProcessForChild } from "@nervekit/native";

/**
 * Force-kill a spawned tool process and every contained descendant. Conversation
 * Stop uses this path deliberately; timeout/task cancellation may remain graceful-first.
 */
export async function forceKillProcessTree(child: ChildProcess): Promise<void> {
  const managed = managedProcessForChild(child);
  if (!managed) {
    throw new Error(
      "Process is not owned by the native managed process runtime",
    );
  }
  const result = await managed.terminate("SIGKILL");
  if (result.error) throw new Error(result.error);
}
