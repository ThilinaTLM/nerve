import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_HELPER_TIMEOUT_MS = 5000;

type ProcessTreeTerminationOptions = {
  platform?: NodeJS.Platform;
  spawnCommand?: typeof spawn;
  helperTimeoutMs?: number;
};

/**
 * Force-kill a spawned tool process and every descendant. Conversation Stop
 * uses this path deliberately; normal timeout/task cancellation may remain
 * graceful-first.
 */
export async function forceKillProcessTree(
  child: ChildProcess,
  options: ProcessTreeTerminationOptions = {},
): Promise<void> {
  if (!child.pid) {
    child.kill("SIGKILL");
    return;
  }

  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    return;
  }

  try {
    await terminateWindowsProcessTree(
      child.pid,
      options.spawnCommand ?? spawn,
      options.helperTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS,
    );
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

async function terminateWindowsProcessTree(
  pid: number,
  spawnCommand: typeof spawn,
  helperTimeoutMs: number,
): Promise<void> {
  let helper: ChildProcess;
  try {
    helper = spawnCommand("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Failed to start taskkill: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      helper.removeListener("error", onError);
      helper.removeListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error) => {
      finish(new Error(`taskkill failed: ${error.message}`));
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0 || code === 128) {
        finish();
        return;
      }
      finish(
        new Error(
          `taskkill exited with code ${code}${signal ? ` and signal ${signal}` : ""}`,
        ),
      );
    };

    helper.once("error", onError);
    helper.once("close", onClose);
    const timeout = setTimeout(
      () => {
        try {
          helper.kill("SIGKILL");
        } catch {
          // The timeout error below remains the actionable failure.
        }
        finish(new Error(`taskkill timed out after ${helperTimeoutMs}ms`));
      },
      Math.max(0, helperTimeoutMs),
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
