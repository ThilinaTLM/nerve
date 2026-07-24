import { Worker } from "node:worker_threads";
import { ToolExecutionError } from "./tool-error.js";

export const HTML_CONVERSION_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const HTML_CONVERSION_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const HTML_CONVERSION_TIMEOUT_MS = 10_000;
const MAX_ACTIVE_WORKERS = 2;
const MAX_QUEUED_CONVERSIONS = 16;

export type HtmlConversionMode = "html" | "confluence-storage";

export class HtmlConversionError extends ToolExecutionError {
  constructor(code: string, message: string, retryable = false) {
    super(code, message, {}, retryable);
  }
}

interface ConversionOptions {
  mode?: HtmlConversionMode;
  signal?: AbortSignal;
  /** Internal override used by deterministic timeout tests. */
  timeoutMs?: number;
}

interface PendingConversion {
  source: string;
  options: ConversionOptions;
  resolve: (markdown: string) => void;
  reject: (error: Error) => void;
  removeQueueAbort?: () => void;
}

type WorkerResult =
  | { ok: true; markdown: string }
  | { ok: false; code: string; message: string };

let activeWorkers = 0;
const queue: PendingConversion[] = [];

function error(
  code: string,
  message: string,
  retryable = false,
): HtmlConversionError {
  return new HtmlConversionError(code, message, retryable);
}

function abortedError(): HtmlConversionError {
  return error("HTML_CONVERSION_ABORTED", "HTML conversion was aborted.");
}

function workerExecArgv(): string[] {
  const retained: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const argument = process.execArgv[index]!;
    if (
      argument === "--import" ||
      argument === "--require" ||
      argument === "-r" ||
      argument === "--loader" ||
      argument === "--experimental-loader"
    ) {
      const value = process.execArgv[index + 1];
      if (value) {
        retained.push(argument, value);
        index += 1;
      }
      continue;
    }
    if (
      argument.startsWith("--import=") ||
      argument.startsWith("--require=") ||
      argument.startsWith("--loader=") ||
      argument.startsWith("--experimental-loader=")
    ) {
      retained.push(argument);
    }
  }
  return retained;
}

function pumpQueue(): void {
  while (activeWorkers < MAX_ACTIVE_WORKERS && queue.length > 0) {
    const pending = queue.shift()!;
    pending.removeQueueAbort?.();
    if (pending.options.signal?.aborted) {
      pending.reject(abortedError());
      continue;
    }
    activeWorkers += 1;
    void runConversion(pending).finally(() => {
      activeWorkers -= 1;
      pumpQueue();
    });
  }
}

async function runConversion(pending: PendingConversion): Promise<void> {
  const { source, options, resolve, reject } = pending;
  const signal = options.signal;
  const timeoutMs = options.timeoutMs ?? HTML_CONVERSION_TIMEOUT_MS;
  let finish!: () => void;
  const finished = new Promise<void>((resolveFinished) => {
    finish = resolveFinished;
  });
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./html-to-markdown.worker.js", import.meta.url),
      {
        execArgv: workerExecArgv(),
        workerData: {
          source,
          mode: options.mode ?? "html",
          maxOutputBytes: HTML_CONVERSION_MAX_OUTPUT_BYTES,
        },
      },
    );
  } catch (cause) {
    reject(
      error(
        "HTML_CONVERSION_WORKER_FAILED",
        `Could not start HTML conversion worker: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
    finish();
    return await finished;
  }

  let settled = false;
  const timeout: { current?: NodeJS.Timeout } = {};
  const settle = (outcome: { markdown: string } | { error: Error }) => {
    if (settled) return;
    settled = true;
    if (timeout.current) clearTimeout(timeout.current);
    signal?.removeEventListener("abort", onAbort);
    void worker.terminate();
    if ("error" in outcome) reject(outcome.error);
    else resolve(outcome.markdown);
    finish();
  };
  const onAbort = () => settle({ error: abortedError() });

  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    onAbort();
    return;
  }
  timeout.current = setTimeout(
    () =>
      settle({
        error: error(
          "HTML_CONVERSION_TIMEOUT",
          `HTML conversion exceeded the ${timeoutMs} ms time limit.`,
          true,
        ),
      }),
    timeoutMs,
  );
  timeout.current.unref();

  worker.once("message", (result: WorkerResult) => {
    if (result.ok) settle({ markdown: result.markdown });
    else settle({ error: error(result.code, result.message) });
  });
  worker.once("error", (cause) => {
    settle({
      error: error(
        "HTML_CONVERSION_WORKER_FAILED",
        `HTML conversion worker failed: ${cause.message}`,
      ),
    });
  });
  worker.once("exit", (code) => {
    if (!settled) {
      settle({
        error: error(
          "HTML_CONVERSION_WORKER_FAILED",
          `HTML conversion worker exited before returning a result (code ${code}).`,
        ),
      });
    }
  });
  await finished;
}

export async function isolatedHtmlToMarkdown(
  source: string,
  options: ConversionOptions = {},
): Promise<string> {
  if (options.signal?.aborted) throw abortedError();
  if (Buffer.byteLength(source, "utf8") > HTML_CONVERSION_MAX_INPUT_BYTES) {
    throw error(
      "HTML_CONVERSION_INPUT_TOO_LARGE",
      "HTML input exceeds the 8 MiB conversion limit.",
    );
  }
  if (queue.length >= MAX_QUEUED_CONVERSIONS) {
    throw error(
      "HTML_CONVERSION_QUEUE_FULL",
      "HTML conversion capacity is full; retry later.",
      true,
    );
  }

  return await new Promise<string>((resolve, reject) => {
    const pending: PendingConversion = {
      source,
      options,
      resolve,
      reject,
    };
    if (options.signal) {
      const onAbort = () => {
        const index = queue.indexOf(pending);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(abortedError());
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      pending.removeQueueAbort = () =>
        options.signal?.removeEventListener("abort", onAbort);
    }
    queue.push(pending);
    pumpQueue();
  });
}
