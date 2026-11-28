import type { LaunchesAgentPort, LaunchRun } from "./launches-port.js";

/** What `waitFor` and `timeout` ask for, validated. */
export type LaunchWait = { pattern: RegExp | string; timeoutMs: number };

export type LaunchWaitResult = {
  run: LaunchRun;
  matched: boolean;
  output: string;
};

/** Clock the wait polls with; tests pass a manual one. */
export type LaunchWaitClock = {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

const POLL_MS = 250;
const TAIL_LINES = 100;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;
const EXITED = new Set(["completed", "failed", "timed_out", "cancelled"]);

const realClock: LaunchWaitClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

/**
 * Reads `waitFor` and `timeout` from a method's options. `waitFor` is a string (a literal
 * substring), a RegExp, or the `{ source, flags }` a RegExp becomes on the JSON bridge.
 */
export function parseLaunchWait(
  options: Record<string, unknown>,
): LaunchWait | undefined {
  const { waitFor, timeout } = options;
  if (waitFor === undefined || waitFor === null) {
    if (timeout !== undefined)
      throw new Error(
        "timeout only applies with waitFor (a RegExp, or a string matched as a literal substring).",
      );
    return undefined;
  }
  const bad = () =>
    new Error(
      "waitFor must be a RegExp or a non-empty string (matched as a literal substring).",
    );
  let pattern: RegExp | string;
  if (typeof waitFor === "string") {
    if (!waitFor) throw bad();
    pattern = waitFor;
  } else if (waitFor instanceof RegExp) {
    pattern = waitFor;
  } else if (
    typeof waitFor === "object" &&
    typeof (waitFor as { source?: unknown }).source === "string"
  ) {
    const { source, flags } = waitFor as { source: string; flags?: unknown };
    try {
      pattern = new RegExp(source, typeof flags === "string" ? flags : "");
    } catch (error) {
      throw new Error(
        `waitFor is not a valid regular expression: ${(error as Error).message}`,
        { cause: error },
      );
    }
  } else throw bad();
  if (
    timeout !== undefined &&
    (typeof timeout !== "number" ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      timeout > MAX_TIMEOUT_S)
  )
    throw new Error(
      `timeout must be a number of seconds from above 0 to ${MAX_TIMEOUT_S} (default ${DEFAULT_TIMEOUT_S}).`,
    );
  return {
    pattern,
    timeoutMs: (timeout ?? DEFAULT_TIMEOUT_S) * 1000,
  };
}

/** Index of the line holding the last character of the first match, or undefined. */
function matchedLine(
  text: string,
  pattern: RegExp | string,
): number | undefined {
  let index: number;
  let length: number;
  if (typeof pattern === "string") {
    index = text.indexOf(pattern);
    length = pattern.length;
  } else {
    // Stateful flags would make a repeated test skip matches.
    const match = new RegExp(
      pattern.source,
      pattern.flags.replace(/[gy]/g, ""),
    ).exec(text);
    if (!match) return undefined;
    index = match.index;
    length = match[0].length;
  }
  if (index < 0) return undefined;
  const end = index + Math.max(length - 1, 0);
  let line = 0;
  for (
    let at = text.indexOf("\n");
    at !== -1 && at < end;
    at = text.indexOf("\n", at + 1)
  )
    line += 1;
  return line;
}

/**
 * Polls the run's own log until it matches, the run exits or the timeout passes. Returns the
 * latest run state and the tail (at most 100 lines) up to the matching line, or of the whole
 * log. A cancelled script (`signal`) rejects with the signal's reason.
 */
export async function waitForLaunchOutput(
  port: Pick<LaunchesAgentPort, "readOutput">,
  runId: string,
  wait: LaunchWait,
  signal?: AbortSignal,
  clock: LaunchWaitClock = realClock,
): Promise<LaunchWaitResult> {
  const deadline = clock.now() + wait.timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const { run, text } = await port.readOutput(runId);
    const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
    const line = text ? matchedLine(text, wait.pattern) : undefined;
    const upTo = line === undefined ? lines.length : line + 1;
    const output = lines.slice(Math.max(0, upTo - TAIL_LINES), upTo).join("\n");
    if (line !== undefined) return { run, matched: true, output };
    if (EXITED.has(run.status) || clock.now() >= deadline)
      return { run, matched: false, output };
    await clock.sleep(Math.min(POLL_MS, deadline - clock.now()), signal);
  }
}
