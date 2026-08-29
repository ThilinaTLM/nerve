import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { spawnManagedProcess } from "./managed-process.js";
import type {
  ManagedProcess,
  ManagedProcessOptions,
  TerminationResult,
} from "./contracts.js";

const childProcesses = new WeakMap<ChildProcess, ManagedProcess>();

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
