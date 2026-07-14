import type { RunRecord } from "@nervekit/contracts";

export interface RunRetryPolicy {
  readonly enabled: boolean;
  /** Number of retries after the initial execution attempt. */
  readonly maxRetries: number;
  readonly baseDelayMs: number;
}

/** Host-owned settings projected into coordinator retry semantics. */
export interface RunRetryPolicyPort {
  readonly enabled: boolean;
  readonly maxRetries: number;
  readonly baseDelayMs: number;
}

export const DEFAULT_RUN_RETRY_POLICY: RunRetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2_000,
};

export interface RunRetryDecision {
  readonly retry: boolean;
  readonly executionAttempt: number;
  /** One-based retry ordinal, excluding the initial provider attempt. */
  readonly retryAttempt: number;
  readonly delayMs: number;
  readonly maxRetries: number;
}

export function countAutomaticRetries(
  transitions: readonly {
    kind: string;
    run: Pick<RunRecord, "failure">;
  }[],
): number {
  return transitions.filter(
    (transition) =>
      transition.kind === "retrying" && transition.run.failure !== undefined,
  ).length;
}

export function decideRunRetry(
  run: RunRecord,
  policy: RunRetryPolicy,
  retriesUsed: number,
): RunRetryDecision {
  const maxRetries = Math.max(0, Math.trunc(policy.maxRetries));
  const normalizedRetriesUsed = Math.max(0, Math.trunc(retriesUsed));
  const retry = policy.enabled && normalizedRetriesUsed < maxRetries;
  return {
    retry,
    executionAttempt: run.attempt + 1,
    retryAttempt: normalizedRetriesUsed + 1,
    delayMs: retry
      ? Math.max(0, Math.trunc(policy.baseDelayMs)) * 2 ** normalizedRetriesUsed
      : 0,
    maxRetries,
  };
}

export function cancellableRetryDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isRetryAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("Run retry delay was cancelled");
  error.name = "AbortError";
  return error;
}
