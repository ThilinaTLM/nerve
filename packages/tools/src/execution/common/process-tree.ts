import { spawn, type ChildProcess } from "node:child_process";

/**
 * Force-kill a spawned tool process and every descendant. Conversation Stop
 * uses this path deliberately; normal timeout/task cancellation may remain
 * graceful-first.
 */
export function forceKillProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill("SIGKILL");
    return;
  }
  if (process.platform === "win32") {
    try {
      const helper = spawn(
        "taskkill",
        ["/F", "/T", "/PID", String(child.pid)],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      helper.once("error", () => {
        child.kill("SIGKILL");
      });
      helper.unref();
      return;
    } catch {
      child.kill("SIGKILL");
      return;
    }
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
