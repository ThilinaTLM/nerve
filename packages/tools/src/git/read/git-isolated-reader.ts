import { fileURLToPath } from "node:url";
import {
  NativeOperationError,
  spawnManagedProcess,
  type ManagedProcess,
  type NativeErrorDetail,
  type NativeGitProjectRepository,
  type NativeGitProjectSnapshot,
} from "@nervekit/native";
import { gitProcessPolicy } from "../../execution/process/managed-process-policy.js";
import {
  categoryOf,
  GIT_ISOLATED_MAX_TIMEOUT_MS,
  GIT_ISOLATED_OUTPUT_BYTES,
  GIT_ISOLATED_STDERR_BYTES,
  GIT_ISOLATED_TIMEOUT_MS,
  isolatedError,
  parseGitIsolatedFrame,
  serializeGitIsolatedInput,
} from "./git-isolated-reader-protocol.js";

const MAX_ACTIVE = 2;
const MAX_WAITING = 16;
const TERMINATION_GRACE_MS = 100;
let active = 0;
interface Waiting {
  signal: AbortSignal;
  deadline: number;
  grant: (release: () => void) => void;
  reject: (error: NativeOperationError) => void;
  cleanup: () => void;
}
const waiting: Waiting[] = [];
function error(detail: NativeErrorDetail): NativeOperationError {
  return new NativeOperationError(detail);
}
function deadlineError(): NativeOperationError {
  return error({
    category: "io",
    retryable: false,
    message: "Isolated Git read exceeded its deadline.",
  });
}
function permit(): () => void {
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    while (active < MAX_ACTIVE && waiting.length) {
      const next = waiting.shift()!;
      next.cleanup();
      if (next.signal.aborted) next.reject(error(isolatedError("cancelled")));
      else if (next.deadline <= Date.now()) next.reject(deadlineError());
      else next.grant(permit());
    }
  };
}
function acquire(signal: AbortSignal, deadline: number): Promise<() => void> {
  if (signal.aborted) return Promise.reject(error(isolatedError("cancelled")));
  if (deadline <= Date.now()) return Promise.reject(deadlineError());
  if (active < MAX_ACTIVE) return Promise.resolve(permit());
  if (waiting.length >= MAX_WAITING)
    return Promise.reject(error(isolatedError("limit_exceeded", true)));
  return new Promise((resolve, reject) => {
    const remove = (cause: NativeOperationError) => {
      const index = waiting.indexOf(entry);
      if (index < 0) return;
      waiting.splice(index, 1);
      entry.cleanup();
      reject(cause);
    };
    const abort = () => remove(error(isolatedError("cancelled")));
    const timer = setTimeout(
      () => remove(deadlineError()),
      Math.max(1, deadline - Date.now()),
    );
    const entry: Waiting = {
      signal,
      deadline,
      grant: resolve,
      reject,
      cleanup: () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      },
    };
    waiting.push(entry);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Source-mode loader propagation follows the existing worker-client pattern;
 * production loads the compiled packaged sibling and needs no TS dependency. */
export function gitIsolatedReaderLaunch(
  moduleUrl = import.meta.url,
  execArgv = process.execArgv,
): string[] {
  const source = moduleUrl.endsWith(".ts");
  const retained: string[] = [];
  if (source) {
    const flags = [
      "--import",
      "--require",
      "-r",
      "--loader",
      "--experimental-loader",
    ];
    for (let i = 0; i < execArgv.length; i++) {
      const argument = execArgv[i];
      if (flags.includes(argument) && execArgv[i + 1])
        retained.push(argument, execArgv[++i]);
      else if (flags.some((flag) => argument.startsWith(`${flag}=`)))
        retained.push(argument);
    }
    if (!retained.length) throw error(isolatedError("internal"));
  }
  return [
    "--max-old-space-size=256",
    "--v8-pool-size=1",
    ...retained,
    fileURLToPath(
      new URL(
        source
          ? "./git-isolated-reader-helper.ts"
          : "./git-isolated-reader-helper.js",
        moduleUrl,
      ),
    ),
  ];
}
export interface GitIsolatedReadOptions {
  includeIgnored?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface GitIsolatedReader {
  read(
    repository: NativeGitProjectRepository,
    options?: GitIsolatedReadOptions,
  ): Promise<NativeGitProjectSnapshot>;
  close(): Promise<void>;
}
interface Dependencies {
  spawn?: typeof spawnManagedProcess;
  launch?: () => string[];
  terminationGraceMs?: number;
}

/** Two active + sixteen waiting globally across all adapter instances. No pool,
 * durable state, policy/authorization changes, or CLI Git read fallback. */
export function createGitIsolatedReader(
  dependencies: Dependencies = {},
): GitIsolatedReader {
  const controller = new AbortController();
  const pending = new Set<Promise<NativeGitProjectSnapshot>>();
  let closed = false;
  return {
    read(repository, options = {}) {
      const work = (async () => {
        if (closed) throw error(isolatedError("cancelled"));
        const timeout = options.timeoutMs ?? GIT_ISOLATED_TIMEOUT_MS;
        if (
          !Number.isSafeInteger(timeout) ||
          timeout < 1 ||
          timeout > GIT_ISOLATED_MAX_TIMEOUT_MS ||
          (options.includeIgnored !== undefined &&
            typeof options.includeIgnored !== "boolean")
        )
          throw error(isolatedError("invalid_input"));
        let input: string;
        // Copy only bounded descriptor fields, not caller metadata or references.
        if (!repository || typeof repository !== "object")
          throw error(isolatedError("invalid_input"));
        const expected = {
          relativePath: repository.relativePath,
          workDir: repository.workDir,
          gitDir: repository.gitDir,
          commonDir: repository.commonDir,
        };
        try {
          input = serializeGitIsolatedInput(
            expected,
            options.includeIgnored ?? false,
          );
        } catch (cause) {
          throw error(
            isolatedError(
              categoryOf(cause) === "limit_exceeded"
                ? "limit_exceeded"
                : "invalid_input",
            ),
          );
        }
        const signal = AbortSignal.any([
          controller.signal,
          ...(options.signal ? [options.signal] : []),
        ]);
        const deadline = Date.now() + timeout;
        const release = await acquire(signal, deadline);
        try {
          if (signal.aborted) throw error(isolatedError("cancelled"));
          return await runHelper(
            expected,
            input,
            signal,
            deadline,
            dependencies,
          );
        } finally {
          release();
        }
      })();
      pending.add(work);
      void work.finally(() => pending.delete(work)).catch(() => {});
      return work;
    },
    async close() {
      closed = true;
      controller.abort();
      await Promise.allSettled([...pending]);
    },
  };
}

async function runHelper(
  repository: NativeGitProjectRepository,
  input: string,
  signal: AbortSignal,
  deadline: number,
  dependencies: Dependencies,
): Promise<NativeGitProjectSnapshot> {
  const grace = dependencies.terminationGraceMs ?? TERMINATION_GRACE_MS;
  let child: ManagedProcess;
  try {
    const env = {
      ...process.env,
      UV_THREADPOOL_SIZE: "1",
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    };
    child = (dependencies.spawn ?? spawnManagedProcess)(
      process.execPath,
      [...(dependencies.launch ?? gitIsolatedReaderLaunch)(), input],
      {
        cwd: repository.workDir,
        env,
        policy: {
          ...gitProcessPolicy(),
          wallTimeMs: Math.max(1, deadline - Date.now()) + grace + 3_000,
          output: {
            queueBytes: 256 * 1024,
            batchBytes: 64 * 1024,
            totalBytes: GIT_ISOLATED_OUTPUT_BYTES + GIT_ISOLATED_STDERR_BYTES,
            overflow: "terminate",
          },
        },
      },
    );
  } catch {
    throw error(isolatedError("internal"));
  }
  let failure: NativeOperationError | undefined;
  let snapshot: NativeGitProjectSnapshot | undefined;
  let stdoutBytes = 0,
    stderrBytes = 0;
  const chunks: Buffer[] = [];
  let frameSeen = false,
    stopping = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const stop = (cause?: NativeOperationError) => {
    if (cause && !failure) failure = cause;
    if (stopping) return;
    stopping = true;
    void child.terminate("SIGTERM").catch(() => {});
    escalation = setTimeout(() => {
      void child.terminate("SIGKILL").catch(() => {});
    }, grace);
  };
  const abort = () => stop(error(isolatedError("cancelled")));
  // Unexpected leader exit is not a result. Request tree cleanup immediately
  // while the host still owns its containment guard/output lifecycle.
  void child.exited.then(
    (exit) => {
      if (!stopping)
        stop(
          exit.reason === "timeout"
            ? deadlineError()
            : error(
                isolatedError(
                  [
                    "memory_limit",
                    "cpu_limit",
                    "process_limit",
                    "output_limit",
                  ].includes(exit.reason ?? "")
                    ? "limit_exceeded"
                    : "internal",
                ),
              ),
        );
    },
    () => stop(error(isolatedError("internal"))),
  );
  const timer = setTimeout(
    () => stop(deadlineError()),
    Math.max(1, deadline - Date.now()),
  );
  child.stdout.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stdoutBytes += buffer.length;
    if (stdoutBytes > GIT_ISOLATED_OUTPUT_BYTES) {
      stop(error(isolatedError("limit_exceeded")));
      return;
    }
    if (failure) return; // Still flowing/draining; do not retain untrusted output.
    if (frameSeen) {
      stop(error(isolatedError("corrupt")));
      return;
    }
    chunks.push(buffer);
    if (buffer.includes(0x0a)) {
      const serialized = Buffer.concat(chunks);
      chunks.length = 0;
      if (serialized.indexOf(0x0a) !== serialized.length - 1) {
        stop(error(isolatedError("corrupt")));
        return;
      }
      frameSeen = true;
      try {
        const text = serialized.toString("utf8");
        if (!Buffer.from(text, "utf8").equals(serialized))
          throw error(isolatedError("corrupt"));
        const parsed = parseGitIsolatedFrame(text, repository);
        if ("category" in parsed) stop(error(parsed));
        else {
          snapshot = parsed;
          stop();
        }
      } catch (cause) {
        stop(
          error(
            isolatedError(
              categoryOf(cause) === "limit_exceeded"
                ? "limit_exceeded"
                : "corrupt",
            ),
          ),
        );
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrBytes += Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk);
    if (stderrBytes > GIT_ISOLATED_STDERR_BYTES)
      stop(error(isolatedError("limit_exceeded")));
  });
  child.stdout.once("error", () => stop(error(isolatedError("io"))));
  child.stderr.once("error", () => stop(error(isolatedError("io"))));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    // Never settle on frame/error/abort/exited alone: the permit belongs to the
    // entire contained helper lifecycle, including escalation and pipe draining.
    const exit = await child.closed;
    const stats = await child.outputStats;
    if (
      stats.totalOmittedBytes > 0 ||
      exit.reason === "output_limit" ||
      exit.reason === "memory_limit" ||
      exit.reason === "process_limit"
    )
      failure ??= error(isolatedError("limit_exceeded"));
    if (exit.reason === "timeout") failure ??= deadlineError();
    if (signal.aborted) failure ??= error(isolatedError("cancelled"));
    if (failure) throw failure;
    if (!snapshot || !frameSeen || !stopping)
      throw error(isolatedError("internal"));
    return snapshot;
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    signal.removeEventListener("abort", abort);
  }
}
