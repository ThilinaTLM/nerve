import { readFile } from "node:fs/promises";

export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Names the condition in the timeout error. */
  message?: string;
}

/** Polls `probe` until it returns a truthy value; fails with `message` and the last probe error as `cause`. */
export async function waitFor<T>(
  probe: () => T | undefined | false | Promise<T | undefined | false>,
  options: WaitForOptions = {},
): Promise<T> {
  const { timeoutMs = 5_000, intervalMs = 10, message = "condition" } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${message}`,
    lastError === undefined ? undefined : { cause: lastError },
  );
}

/** Lets already-queued promise continuations and I/O callbacks run once. */
export const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

async function processIsAlive(pid: number): Promise<boolean> {
  if (process.platform === "linux") {
    // A zombie still answers `kill(pid, 0)`; its /proc state says `Z`.
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(
      () => undefined,
    );
    if (!stat) return false;
    return stat.slice(stat.lastIndexOf(")") + 2).at(0) !== "Z";
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

/** Waits until process `pid` is gone (zombies count as gone on Linux). */
export async function waitForProcessExit(
  pid: number,
  options: Omit<WaitForOptions, "message"> = {},
): Promise<void> {
  await waitFor(async () => !(await processIsAlive(pid)), {
    timeoutMs: 2_000,
    intervalMs: 20,
    ...options,
    message: `process ${pid} to exit`,
  });
}
