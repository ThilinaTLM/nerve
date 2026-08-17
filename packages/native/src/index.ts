import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export type NativeContainment = "job-object" | "process-group" | "fallback";

export interface ManagedProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface ManagedProcess {
  readonly pid: number;
  readonly identity: string;
  readonly containment: NativeContainment;
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

export interface TerminationResult {
  attempted: boolean;
  method: "job-object" | "process-group" | "direct-child" | "taskkill" | "none";
  error?: string;
}

interface InternalManagedProcess extends ManagedProcess {
  readonly childProcess?: ChildProcess;
}

interface NativeProcessHandle {
  readonly pid: number;
  readonly identity: string;
  readonly containment: "job-object" | "process-group";
  terminate(signal?: string): boolean;
}

interface NativeBinding {
  inspectProcess(pid: number): string | null;
  runtimeCapabilities(): string[];
  spawnManagedProcess(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> },
    stdout: (error: Error | null, chunk: Buffer) => void,
    stderr: (error: Error | null, chunk: Buffer) => void,
    exit: (error: Error | null, result: [number, string]) => void,
  ): NativeProcessHandle;
}

let bindingResult: { binding?: NativeBinding; error?: string } | undefined;
const childProcesses = new WeakMap<ChildProcess, ManagedProcess>();

export function nativeRuntimeCapabilities(): {
  available: boolean;
  capabilities: string[];
  error?: string;
} {
  const loaded = loadBinding();
  return {
    available: Boolean(loaded.binding),
    capabilities: loaded.binding?.runtimeCapabilities() ?? [],
    error: loaded.error,
  };
}

export function spawnManagedChildProcess(
  command: string,
  args: string[],
  options: ManagedProcessOptions = {},
): ChildProcess {
  const managed = spawnManagedProcess(
    command,
    args,
    options,
  ) as InternalManagedProcess;
  if (managed.childProcess) {
    childProcesses.set(managed.childProcess, managed);
    return managed.childProcess;
  }
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

export function inspectProcess(pid: number): string | undefined {
  const binding = loadBinding().binding;
  return binding?.inspectProcess(pid) ?? undefined;
}

export function spawnManagedProcess(
  command: string,
  args: string[],
  options: ManagedProcessOptions = {},
): ManagedProcess {
  const loaded = loadBinding();
  if (!loaded.binding) return spawnFallback(command, args, options);

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveExit!: (result: ManagedProcessExit) => void;
  const exited = new Promise<ManagedProcessExit>((resolve) => {
    resolveExit = resolve;
  });
  let settled = false;
  const finish = (result: ManagedProcessExit) => {
    if (settled) return;
    settled = true;
    stdout.end();
    stderr.end();
    resolveExit(result);
  };
  let handle: NativeProcessHandle;
  try {
    handle = loaded.binding.spawnManagedProcess(
      command,
      args,
      {
        cwd: options.cwd,
        env: stringEnvironment(options.env),
      },
      (error, chunk) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        else stdout.write(chunk);
      },
      (error, chunk) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        else stderr.write(chunk);
      },
      (error, [code, signal]) => {
        if (error) stderr.write(Buffer.from(`${error.message}\n`));
        finish({
          exitCode: code < 0 ? null : code,
          signal: signalName(signal),
        });
      },
    );
  } catch {
    stdout.destroy();
    stderr.destroy();
    return spawnFallback(command, args, options);
  }

  return {
    pid: handle.pid,
    identity: handle.identity,
    containment: handle.containment,
    stdout,
    stderr,
    exited,
    closed: exited,
    async terminate(signal = "SIGKILL") {
      try {
        const attempted = handle.terminate(signal);
        return {
          attempted,
          method:
            handle.containment === "job-object"
              ? ("job-object" as const)
              : ("process-group" as const),
        };
      } catch (error) {
        return {
          attempted: true,
          method:
            handle.containment === "job-object"
              ? ("job-object" as const)
              : ("process-group" as const),
          error: errorMessage(error),
        };
      }
    },
  };
}

function spawnFallback(
  command: string,
  args: string[],
  options: ManagedProcessOptions,
): InternalManagedProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const { exited, closed } = observeChild(child);
  return {
    pid: child.pid ?? 0,
    identity: `fallback:${child.pid ?? 0}:${Date.now()}`,
    containment: "fallback",
    childProcess: child,
    stdout: child.stdout ?? new PassThrough(),
    stderr: child.stderr ?? new PassThrough(),
    exited,
    closed,
    terminate: (signal = "SIGKILL") => terminateFallback(child, signal),
  };
}

function observeChild(child: ChildProcess): {
  exited: Promise<ManagedProcessExit>;
  closed: Promise<ManagedProcessExit>;
} {
  let resolveExited!: (result: ManagedProcessExit) => void;
  let resolveClosed!: (result: ManagedProcessExit) => void;
  let exitedDone = false;
  let closedDone = false;
  const exited = new Promise<ManagedProcessExit>((resolve) => {
    resolveExited = resolve;
  });
  const closed = new Promise<ManagedProcessExit>((resolve) => {
    resolveClosed = resolve;
  });
  const finishExited = (result: ManagedProcessExit) => {
    if (!exitedDone) {
      exitedDone = true;
      resolveExited(result);
    }
  };
  const finishClosed = (result: ManagedProcessExit) => {
    if (!closedDone) {
      closedDone = true;
      resolveClosed(result);
    }
  };
  child.once("error", () => {
    const result = { exitCode: 127, signal: null };
    finishExited(result);
    finishClosed(result);
  });
  child.once("exit", (exitCode, signal) => finishExited({ exitCode, signal }));
  child.once("close", (exitCode, signal) => {
    const result = { exitCode, signal };
    finishExited(result);
    finishClosed(result);
  });
  return { exited, closed };
}

async function terminateFallback(
  child: ChildProcess,
  signal: NodeJS.Signals,
): Promise<TerminationResult> {
  if (!child.pid)
    return { attempted: false, method: "none", error: "Missing child PID" };
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return { attempted: true, method: "process-group" };
    } catch {
      const attempted = child.kill(signal);
      return { attempted, method: "direct-child" };
    }
  }
  return terminateWindowsTree(child.pid, child);
}

async function terminateWindowsTree(
  pid: number,
  child: ChildProcess,
): Promise<TerminationResult> {
  let helper: ChildProcess;
  try {
    helper = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    const attempted = child.kill("SIGKILL");
    return { attempted, method: "direct-child", error: errorMessage(error) };
  }
  return await new Promise((resolve) => {
    let done = false;
    const finish = (result: TerminationResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    helper.once("error", (error) =>
      finish({ attempted: true, method: "taskkill", error: error.message }),
    );
    helper.once("close", (code) =>
      finish({
        attempted: true,
        method: "taskkill",
        error:
          code === 0 || code === 128
            ? undefined
            : `taskkill exited with code ${code}`,
      }),
    );
    const timer = setTimeout(() => {
      helper.kill("SIGKILL");
      child.kill("SIGKILL");
      finish({
        attempted: true,
        method: "taskkill",
        error: "taskkill timed out after 1000ms",
      });
    }, 1_000);
  });
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
  const number = Number(value);
  if (number === 9) return "SIGKILL";
  if (number === 15) return "SIGTERM";
  if (number === 2) return "SIGINT";
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
