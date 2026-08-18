import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export type NativeContainment = "job-object" | "process-group";
export type TerminationMethod =
  | "job-object"
  | "process-group"
  | "process-tree"
  | "direct-child"
  | "none";

export interface ManagedTarget {
  pid: number;
  processGroupId?: number;
  containment: NativeContainment;
  identity: string;
}

export type InspectionResult =
  | { evidence: "alive_verified"; detail?: string }
  | { evidence: "exited_verified"; detail?: string }
  | { evidence: "identity_mismatch"; detail?: string }
  | { evidence: "unknown"; detail: string };

export interface TerminationResult {
  attempted: boolean;
  terminated: boolean;
  method: TerminationMethod;
  error?: string;
}

export interface ManagedProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface ManagedProcess {
  readonly pid: number;
  readonly identity: string;
  readonly containment: NativeContainment;
  readonly target: ManagedTarget;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly exited: Promise<ManagedProcessExit>;
  readonly closed: Promise<ManagedProcessExit>;
  terminate(signal?: NodeJS.Signals): Promise<TerminationResult>;
}

export interface ManagedProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface NativeProcessHandle {
  readonly pid: number;
  readonly identity: string;
  readonly containment: NativeContainment;
  readonly processGroupId?: number;
  readonly target: ManagedTarget;
  terminate(signal?: string): TerminationResult;
}

interface NativeBinding {
  inspectManagedTarget(target: ManagedTarget): InspectionResult;
  terminateManagedTarget(
    target: ManagedTarget,
    signal?: string,
  ): TerminationResult;
  runtimeCapabilities(): { platform: string; capabilities: string[] };
  spawnManagedProcess(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> },
    stdout: (error: Error | null, chunk: Buffer) => void,
    stderr: (error: Error | null, chunk: Buffer) => void,
    exit: (error: Error | null, result: [number, string]) => void,
    close: (error: Error | null, result: [number, string]) => void,
  ): NativeProcessHandle;
}

let bindingResult: { binding?: NativeBinding; error?: string } | undefined;
const childProcesses = new WeakMap<ChildProcess, ManagedProcess>();

export function nativeRuntimeCapabilities(): {
  available: boolean;
  platform?: string;
  capabilities: string[];
  error?: string;
} {
  const loaded = loadBinding();
  const native = loaded.binding?.runtimeCapabilities();
  return {
    available: Boolean(loaded.binding),
    platform: native?.platform,
    capabilities: native?.capabilities ?? [],
    error: loaded.error,
  };
}

export function inspectManagedTarget(target: ManagedTarget): InspectionResult {
  const loaded = loadBinding();
  if (!loaded.binding) {
    return {
      evidence: "unknown",
      detail: loaded.error ?? "Native runtime is unavailable",
    };
  }
  try {
    return loaded.binding.inspectManagedTarget(target);
  } catch (error) {
    return { evidence: "unknown", detail: errorMessage(error) };
  }
}

export async function terminateManagedTarget(
  target: ManagedTarget,
  signal: NodeJS.Signals = "SIGKILL",
): Promise<TerminationResult> {
  const loaded = loadBinding();
  if (!loaded.binding) return unavailableTermination(loaded.error);
  try {
    return loaded.binding.terminateManagedTarget(target, signal);
  } catch (error) {
    return {
      attempted: false,
      terminated: false,
      method: "none",
      error: errorMessage(error),
    };
  }
}

export function spawnManagedProcess(
  command: string,
  args: string[],
  options: ManagedProcessOptions = {},
): ManagedProcess {
  const binding = requireBinding();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exited = deferred<ManagedProcessExit>();
  const closed = deferred<ManagedProcessExit>();
  let exitSettled = false;
  let closeSettled = false;

  const settleExit = (result: ManagedProcessExit) => {
    if (exitSettled) return;
    exitSettled = true;
    exited.resolve(result);
  };
  const settleClose = (result: ManagedProcessExit) => {
    if (closeSettled) return;
    closeSettled = true;
    stdout.end();
    stderr.end();
    settleExit(result);
    closed.resolve(result);
  };

  let handle: NativeProcessHandle;
  try {
    handle = binding.spawnManagedProcess(
      command,
      args,
      { cwd: options.cwd, env: stringEnvironment(options.env) },
      (error, chunk) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        else stdout.write(chunk);
      },
      (error, chunk) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        else stderr.write(chunk);
      },
      (error, result) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        settleExit(exitResult(result));
      },
      (error, result) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        settleClose(exitResult(result));
      },
    );
  } catch (error) {
    stdout.destroy();
    stderr.destroy();
    throw error;
  }

  const target = normalizeTarget(handle.target, handle);
  return {
    pid: handle.pid,
    identity: handle.identity,
    containment: handle.containment,
    target,
    stdout,
    stderr,
    exited: exited.promise,
    closed: closed.promise,
    async terminate(signal = "SIGKILL") {
      try {
        return handle.terminate(signal);
      } catch (error) {
        return {
          attempted: false,
          terminated: false,
          method: "none",
          error: errorMessage(error),
        };
      }
    },
  };
}

export function spawnManagedChildProcess(
  command: string,
  args: string[],
  options: ManagedProcessOptions = {},
): ChildProcess {
  const managed = spawnManagedProcess(command, args, options);
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    pid: { value: managed.pid, enumerable: true },
    stdout: { value: managed.stdout, enumerable: true },
    stderr: { value: managed.stderr, enumerable: true },
    stdin: { value: null, enumerable: true },
    exitCode: { value: null, writable: true, enumerable: true },
    signalCode: { value: null, writable: true, enumerable: true },
    killed: { value: false, writable: true, enumerable: true },
  });
  child.kill = (signal = "SIGTERM") => {
    Reflect.set(child, "killed", true);
    void managed.terminate(typeof signal === "string" ? signal : "SIGTERM");
    return true;
  };
  void managed.exited.then(({ exitCode, signal }) => {
    Reflect.set(child, "exitCode", exitCode);
    Reflect.set(child, "signalCode", signal);
    child.emit("exit", exitCode, signal);
  });
  void managed.closed.then(({ exitCode, signal }) =>
    child.emit("close", exitCode, signal),
  );
  childProcesses.set(child, managed);
  return child;
}

export function managedProcessForChild(
  child: ChildProcess,
): ManagedProcess | undefined {
  return childProcesses.get(child);
}

export async function terminateManagedChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGKILL",
): Promise<TerminationResult | undefined> {
  return childProcesses.get(child)?.terminate(signal);
}

function requireBinding(): NativeBinding {
  const loaded = loadBinding();
  if (loaded.binding) return loaded.binding;
  throw new Error(
    `Native managed process runtime unavailable: ${loaded.error}`,
  );
}

function loadBinding(): { binding?: NativeBinding; error?: string } {
  if (bindingResult) return bindingResult;
  if (process.env.NERVE_DISABLE_NATIVE === "1") {
    bindingResult = {
      error: "Native runtime disabled by NERVE_DISABLE_NATIVE",
    };
    return bindingResult;
  }
  const require = createRequire(import.meta.url);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const binaryName = `nerve_native.${platformTriple()}.node`;
  const candidates = [
    join(moduleDir, "..", "prebuilds", binaryName),
    join(moduleDir, "..", "prebuilds", "local", binaryName),
    join(moduleDir, "..", "..", "prebuilds", binaryName),
    join(moduleDir, "..", "..", "prebuilds", "local", binaryName),
  ];
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      bindingResult = { binding: require(candidate) as NativeBinding };
      return bindingResult;
    } catch (error) {
      errors.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  bindingResult = {
    error:
      errors.join("; ") ||
      `No native prebuild for ${process.platform}/${process.arch}`,
  };
  return bindingResult;
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

function exitResult([code, signal]: [number, string]): ManagedProcessExit {
  return {
    exitCode: code < 0 ? null : code,
    signal: signalName(signal),
  };
}

function unavailableTermination(error?: string): TerminationResult {
  return {
    attempted: false,
    terminated: false,
    method: "none",
    error: error ?? "Native runtime is unavailable",
  };
}

function platformTriple(): string {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "linux") return `linux-${process.arch}-gnu`;
  return `${process.platform}-${process.arch}`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
