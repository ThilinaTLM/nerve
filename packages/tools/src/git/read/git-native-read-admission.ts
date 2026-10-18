import { NativeOperationError } from "@nervekit/native";
import { GitOperationLanes } from "../git-operation-lanes.js";
import { currentGitCommandOptions } from "../git-operation-context.js";

// Separate native-operation budget, NOT the global Git network pool. These keys
// are synthetic admission IDs, never repository paths. Discovery shares this cap.
const operations = new GitOperationLanes(2, 64);
let next = 0;
// Keep only two calls inside the helper adapter; its own queue remains a safety
// boundary rather than overflowing simply because a project has >18 filtered repos.
const isolated = new GitOperationLanes(2, 256);
let nextIsolated = 0;
export function runIsolatedGitRead<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return isolated.run(
    `isolated-git-read:${++nextIsolated}`,
    true,
    () => {
      signal.throwIfAborted();
      return run();
    },
    signal,
  );
}

export function runNativeGitProjectRead<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  deadlineAt = Math.min(
    currentGitCommandOptions().deadlineAt ?? Infinity,
    performance.now() + 120_000,
  ),
): Promise<T> {
  const deadline = new AbortController();
  const combined = AbortSignal.any([signal, deadline.signal]);
  const expire = () =>
    deadline.abort(
      new NativeOperationError({
        category: "limit_exceeded",
        retryable: true,
        message:
          "Native Git read deadline exceeded. Retry after other work finishes.",
      }),
    );
  const remaining = deadlineAt - performance.now();
  if (remaining <= 0) expire();
  const timer = setTimeout(expire, Math.max(1, remaining));
  return operations
    .run(
      `native-git-read:${++next}`,
      true,
      async () => {
        let delayMs = 25;
        for (;;) {
          combined.throwIfAborted();
          try {
            const value = await run(combined);
            combined.throwIfAborted();
            return value;
          } catch (error) {
            combined.throwIfAborted();
            // Native monitors share the native cap but not this TS queue. Only a
            // typed retryable capacity rejection is retried; real result bounds fail.
            if (
              !(error instanceof NativeOperationError) ||
              error.category !== "limit_exceeded" ||
              !error.retryable
            )
              throw error;
            await waitForCapacity(delayMs, combined);
            delayMs = Math.min(delayMs * 2, 250);
          }
        }
      },
      combined,
    )
    .finally(() => clearTimeout(timer));
}

function waitForCapacity(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}
