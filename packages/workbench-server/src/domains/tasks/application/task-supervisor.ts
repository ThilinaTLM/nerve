import type { ChildProcess } from "node:child_process";
import type {
  TaskListeningPort,
  TaskRuntime,
  TaskRuntimeIdentity,
} from "@nervekit/contracts/tasks";
import {
  inspectManagedTarget,
  managedProcessForChild,
  nativeRuntimeCapabilities,
  spawnManagedChildProcess,
  terminateManagedTarget,
  type ManagedProcessExit,
  type ManagedTarget,
  type TerminationMethod,
} from "@nervekit/native";
import { resolveBashShellConfig } from "@nervekit/tools";
import { taskProcessPolicy } from "../model/task-process-policy.js";
import {
  defaultTaskPortInspector,
  type TaskPortInspector,
} from "../adapters/task-port-inspector.js";

export interface SpawnManagedTaskOptions {
  cwd: string;
  env?: Record<string, string>;
  shellPath?: string;
}

export type ProcessLifecycleResult =
  | {
      kind: "closed";
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      reason?: ManagedProcessExit["reason"];
    }
  | { kind: "error"; error: Error };

export interface SpawnedManagedTask {
  child: ChildProcess;
  runtime: Promise<TaskRuntime>;
  exited: Promise<ProcessLifecycleResult>;
  closed: Promise<ProcessLifecycleResult>;
}

export interface TerminateTaskResult {
  attempted: boolean;
  terminated: boolean;
  method: TerminationMethod;
  error?: string;
}

export interface TaskSupervisor {
  spawn(command: string, options: SpawnManagedTaskOptions): SpawnedManagedTask;
  terminate(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<TerminateTaskResult>;
  terminateRuntime(
    runtime: TaskRuntime,
    signal: NodeJS.Signals,
  ): Promise<TerminateTaskResult>;
  isRuntimeTargetAlive(runtime: TaskRuntime): Promise<boolean>;
  inspectRuntimeListeningPorts(
    runtime: TaskRuntime,
  ): Promise<TaskListeningPort[]>;
  inspectPortListeners(
    ports: TaskListeningPort[],
  ): Promise<TaskListeningPort[]>;
  inspectConfiguredPort(
    port: number,
  ): Promise<import("@nervekit/contracts/tasks").TaskPortConflictListener[]>;
  terminateConfiguredPortListener(
    listener: import("@nervekit/contracts/tasks").TaskPortConflictListener,
    signal: "SIGTERM" | "SIGKILL",
  ): Promise<TerminateTaskResult>;
}

export function managedTaskShellCommand(
  command: string,
  shellPath?: string,
): { shell: string; args: string[] } {
  const shellConfig = resolveBashShellConfig({ shellPath });
  return {
    shell: shellConfig.shell,
    args: [...shellConfig.args, command],
  };
}

export function createTaskSupervisor(
  portInspector: TaskPortInspector = defaultTaskPortInspector,
): TaskSupervisor {
  return {
    spawn(command, options) {
      const shell = managedTaskShellCommand(command, options.shellPath);
      const child = spawnManagedChildProcess(shell.shell, shell.args, {
        cwd: options.cwd,
        env: processEnvironment(options.env),
        policy: taskProcessPolicy(),
      });
      const managed = managedProcessForChild(child);
      if (!managed) {
        throw new Error("Native managed process metadata was not registered");
      }
      return {
        child,
        runtime: Promise.resolve(runtimeForManagedTarget(managed.target)),
        exited: managed.exited.then(lifecycleResult),
        closed: managed.closed.then(lifecycleResult),
      };
    },
    async terminate(child, signal) {
      const managed = managedProcessForChild(child);
      if (!managed) {
        return {
          attempted: false,
          terminated: false,
          method: "none",
          error: "Child is not owned by the native managed process runtime",
        };
      }
      return managed.terminate(signal);
    },
    async terminateRuntime(runtime, signal) {
      const target = managedTargetForRuntime(runtime);
      if ("error" in target) return refusedTermination(target.error);
      return terminateManagedTarget(target, signal);
    },
    async isRuntimeTargetAlive(runtime) {
      const target = managedTargetForRuntime(runtime);
      if ("error" in target) throw new Error(target.error);
      const inspection = inspectManagedTarget(target);
      if (inspection.evidence === "alive_verified") return true;
      if (
        inspection.evidence === "exited_verified" ||
        inspection.evidence === "identity_mismatch"
      ) {
        return false;
      }
      throw new Error(inspection.detail);
    },
    async inspectRuntimeListeningPorts(runtime) {
      if (!(await this.isRuntimeTargetAlive(runtime))) return [];
      return portInspector.inspectRuntime(runtime);
    },
    inspectPortListeners: (ports) => portInspector.inspectListeners(ports),
    inspectConfiguredPort: (port) => portInspector.inspectPort(port),
    terminateConfiguredPortListener: (listener, signal) =>
      portInspector.terminateListener(listener, signal),
  };
}

export const defaultTaskSupervisor = createTaskSupervisor();

function runtimeForManagedTarget(target: ManagedTarget): TaskRuntime {
  const capabilities = nativeRuntimeCapabilities();
  return {
    version: 2,
    platform: process.platform,
    childPid: target.pid,
    processGroupId: target.processGroupId,
    detached: target.containment === "process-group",
    shell: true,
    containment: target.containment,
    spawnedAt: new Date().toISOString(),
    identity: runtimeIdentity(target.identity),
    capabilities: {
      identity: capabilities.capabilities.includes("stable-process-identity"),
      processTree: capabilities.capabilities.includes(
        "process-tree-termination",
      ),
      listeningPorts: ["linux", "darwin", "win32"].includes(process.platform),
      detail: `native:${target.containment}`,
    },
  };
}

function runtimeIdentity(identity: string): TaskRuntimeIdentity {
  if (identity.startsWith("linux:")) {
    const startTimeTicks = Number(identity.slice("linux:".length));
    if (Number.isSafeInteger(startTimeTicks) && startTimeTicks >= 0) {
      return { kind: "linux", startTimeTicks };
    }
  }
  if (identity.startsWith("darwin:")) {
    return { kind: "darwin", startFingerprint: identity };
  }
  if (identity.startsWith("win32:")) {
    return { kind: "win32", creationDate: identity };
  }
  throw new Error(
    `Native runtime returned an unsupported identity: ${identity}`,
  );
}

function managedTargetForRuntime(
  runtime: TaskRuntime,
): ManagedTarget | { error: string } {
  if (runtime.platform !== process.platform) {
    return {
      error: `Cannot clean up task spawned on ${runtime.platform} from ${process.platform}.`,
    };
  }
  return {
    pid: runtime.childPid,
    processGroupId: runtime.processGroupId,
    containment: runtime.containment,
    identity: nativeIdentityForRuntime(runtime.identity),
  };
}

function nativeIdentityForRuntime(identity: TaskRuntimeIdentity): string {
  if (identity.kind === "linux") return `linux:${identity.startTimeTicks}`;
  if (identity.kind === "darwin") return identity.startFingerprint;
  return identity.creationDate;
}

function processEnvironment(
  overrides?: Record<string, string>,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    TERM: "dumb",
    ...(overrides ?? {}),
  };
}

function lifecycleResult(exit: ManagedProcessExit): ProcessLifecycleResult {
  return { kind: "closed", ...exit };
}

function refusedTermination(error: string): TerminateTaskResult {
  return {
    attempted: false,
    terminated: false,
    method: "none",
    error,
  };
}
