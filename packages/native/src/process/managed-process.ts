import { PassThrough } from "node:stream";
import { binding } from "../binding/loader.js";
import type {
  NativeOutputEvent,
  NativeProcessHandle,
} from "./native-contract.js";
import type {
  InspectionResult,
  ManagedProcess,
  ManagedProcessExit,
  ManagedProcessExitReason,
  ManagedProcessOptions,
  ManagedProcessOutputStats,
  ManagedProcessRuntimeOptions,
  ManagedTarget,
  TerminationResult,
} from "./types.js";

export function configureManagedProcessRuntime(
  options: ManagedProcessRuntimeOptions,
): void {
  binding.configureManagedProcessRuntime(options);
}

export function inspectManagedTarget(target: ManagedTarget): InspectionResult {
  try {
    return binding.inspectManagedTarget(target);
  } catch (error) {
    return { evidence: "unknown", detail: errorMessage(error) };
  }
}

export async function terminateManagedTarget(
  target: ManagedTarget,
  signal: NodeJS.Signals = "SIGKILL",
): Promise<TerminationResult> {
  try {
    return binding.terminateManagedTarget(target, signal);
  } catch (error) {
    return failedTermination(error);
  }
}

export function spawnManagedProcess(
  command: string,
  args: string[],
  options: ManagedProcessOptions = {},
): ManagedProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exited = deferred<ManagedProcessExit>();
  const closed = deferred<ManagedProcessExit>();
  const outputStats = deferred<ManagedProcessOutputStats>();
  let exitValue: ManagedProcessExit | undefined;
  let pipesDrained = false;
  let outputMarkerWritten = false;
  let closeSettled = false;
  let pumpScheduled = false;
  let pumping = false;
  let ready = false;
  let pending: NativeOutputEvent[] = [];
  let pendingIndex = 0;
  let lastStats = emptyOutputStats();
  const blocked = new Set<PassThrough>();
  let handle: NativeProcessHandle | undefined;

  const settleCloseIfReady = () => {
    if (closeSettled || !exitValue || !pipesDrained || blocked.size > 0) return;
    if (!outputMarkerWritten && lastStats.totalOmittedBytes > 0) {
      outputMarkerWritten = true;
      const accepted = stderr.write(
        Buffer.from(
          `\n[${lastStats.totalOmittedBytes} output bytes omitted by native process policy]\n`,
        ),
      );
      if (!accepted) {
        waitForDrain(stderr);
        return;
      }
    }
    closeSettled = true;
    stdout.end();
    stderr.end();
    outputStats.resolve(lastStats);
    closed.resolve(exitValue);
  };

  const waitForDrain = (stream: PassThrough) => {
    if (blocked.has(stream)) return;
    blocked.add(stream);
    const resume = () => {
      stream.removeListener("drain", resume);
      stream.removeListener("close", resume);
      stream.removeListener("error", resume);
      blocked.delete(stream);
      schedulePump();
      settleCloseIfReady();
    };
    stream.once("drain", resume);
    stream.once("close", resume);
    stream.once("error", resume);
  };

  const writeEvent = (event: NativeOutputEvent): void => {
    const stream = event.stream === "stdout" ? stdout : stderr;
    if (stream.destroyed || stream.writableEnded) return;
    try {
      if (!stream.write(event.data)) waitForDrain(stream);
    } catch {
      // A consumer may destroy its readable; native draining must still finish.
    }
  };

  const pump = () => {
    pumpScheduled = false;
    if (pumping || blocked.size > 0 || !handle) return;
    pumping = true;
    try {
      while (blocked.size === 0) {
        while (pendingIndex < pending.length && blocked.size === 0) {
          const event = pending[pendingIndex];
          pendingIndex += 1;
          if (event) writeEvent(event);
        }
        if (blocked.size > 0) return;
        pending = [];
        pendingIndex = 0;
        if (!ready) return;
        const drained = handle.drainOutput(handle.batchBytes);
        lastStats = drained.stats;
        pending = drained.events;
        if (drained.pipesClosed && !drained.hasMore && pending.length === 0) {
          ready = false;
          pipesDrained = true;
          settleCloseIfReady();
          return;
        }
        if (pending.length === 0 && !drained.hasMore) {
          ready = false;
          return;
        }
      }
    } finally {
      pumping = false;
      if ((ready || pendingIndex < pending.length) && blocked.size === 0) {
        schedulePump();
      }
    }
  };

  function schedulePump(): void {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(pump);
  }

  try {
    handle = binding.spawnManagedProcess(
      command,
      args,
      {
        cwd: options.cwd,
        env: stringEnvironment(options.env),
        policy: options.policy,
      },
      (error) => {
        if (error) {
          stderr.write(Buffer.from(`${error.message}\n`));
          return;
        }
        ready = true;
        schedulePump();
      },
      (error, result) => {
        if (error) {
          stderr.write(Buffer.from(`${error.message}\n`));
          exitValue = {
            exitCode: null,
            signal: null,
            reason: "internal",
          };
        } else {
          exitValue = exitResult(result);
        }
        exited.resolve(exitValue);
        settleCloseIfReady();
      },
    );
  } catch (error) {
    stdout.destroy();
    stderr.destroy();
    throw error;
  }

  if (ready) schedulePump();
  const nativeHandle = handle;
  const target = normalizeTarget(nativeHandle.target, nativeHandle);
  return {
    pid: nativeHandle.pid,
    identity: nativeHandle.identity,
    containment: nativeHandle.containment,
    target,
    stdout,
    stderr,
    enforcement: nativeHandle.enforcement,
    exited: exited.promise,
    closed: closed.promise,
    outputStats: outputStats.promise,
    async terminate(signal = "SIGKILL") {
      try {
        return nativeHandle.terminate(signal);
      } catch (error) {
        return failedTermination(error);
      }
    },
  };
}

function normalizeTarget(
  target: ManagedTarget | undefined,
  handle: NativeProcessHandle,
): ManagedTarget {
  return (
    target ?? {
      pid: handle.pid,
      processGroupId: handle.processGroupId,
      containment: handle.containment,
      identity: handle.identity,
    }
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function exitResult([code, signal, reason]: [
  number,
  string,
  string,
]): ManagedProcessExit {
  return {
    exitCode: code < 0 ? null : code,
    signal: signalName(signal),
    reason: reason as ManagedProcessExitReason,
  };
}

function stringEnvironment(env: NodeJS.ProcessEnv | undefined) {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function signalName(value: string): NodeJS.Signals | null {
  if (!value) return null;
  if (value.startsWith("SIG")) return value as NodeJS.Signals;
  const number = Number(value);
  if (number === 9) return "SIGKILL";
  if (number === 15) return "SIGTERM";
  if (number === 2) return "SIGINT";
  if (number === 1) return "SIGHUP";
  return null;
}

function failedTermination(error: unknown): TerminationResult {
  return {
    attempted: false,
    terminated: false,
    method: "none",
    error: errorMessage(error),
  };
}

function emptyOutputStats(): ManagedProcessOutputStats {
  return {
    stdoutObservedBytes: 0,
    stderrObservedBytes: 0,
    stdoutDeliveredBytes: 0,
    stderrDeliveredBytes: 0,
    stdoutOmittedBytes: 0,
    stderrOmittedBytes: 0,
    totalObservedBytes: 0,
    totalDeliveredBytes: 0,
    totalOmittedBytes: 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
