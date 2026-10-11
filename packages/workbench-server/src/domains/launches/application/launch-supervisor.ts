import type { ChildProcess } from "node:child_process";
import type {
  LaunchListeningPort,
  LaunchRuntime,
  LaunchRuntimeIdentity,
} from "@nervekit/contracts/launches";
import {
  nativeRuntimeCapabilities,
  type ManagedProcessExit,
  type ManagedTarget,
  type TerminationMethod,
} from "@nervekit/native";
import {
  spawnShellProcess,
  terminateProcessChild,
  terminateProcessTarget,
  isProcessTargetAlive,
} from "../../../infrastructure/process-host/shell-process.js";
import { launchProcessPolicy } from "../model/launch-process-policy.js";
import {
  defaultLaunchPortInspector,
  type LaunchPortInspector,
} from "../../../infrastructure/process-host/port-inspector.js";

export interface SpawnManagedLaunchOptions {
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

export interface SpawnedManagedLaunch {
  child: ChildProcess;
  runtime: Promise<LaunchRuntime>;
  exited: Promise<ProcessLifecycleResult>;
  closed: Promise<ProcessLifecycleResult>;
}

export interface TerminateLaunchResult {
  attempted: boolean;
  terminated: boolean;
  method: TerminationMethod;
  error?: string;
}

export interface LaunchSupervisor {
  spawn(
    command: string,
    options: SpawnManagedLaunchOptions,
  ): SpawnedManagedLaunch;
  terminate(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<TerminateLaunchResult>;
  terminateRuntime(
    runtime: LaunchRuntime,
    signal: NodeJS.Signals,
  ): Promise<TerminateLaunchResult>;
  isRuntimeTargetAlive(runtime: LaunchRuntime): Promise<boolean>;
  inspectRuntimeListeningPorts(
    runtime: LaunchRuntime,
  ): Promise<LaunchListeningPort[]>;
  inspectPortListeners(
    ports: LaunchListeningPort[],
  ): Promise<LaunchListeningPort[]>;
  inspectConfiguredPort(
    port: number,
  ): Promise<
    import("@nervekit/contracts/launches").LaunchPortConflictListener[]
  >;
  terminateConfiguredPortListener(
    listener: import("@nervekit/contracts/launches").LaunchPortConflictListener,
    signal: "SIGTERM" | "SIGKILL",
  ): Promise<TerminateLaunchResult>;
}

export function createLaunchSupervisor(
  portInspector: LaunchPortInspector = defaultLaunchPortInspector,
): LaunchSupervisor {
  return {
    spawn(command, options) {
      const { child, managed } = spawnShellProcess(command, {
        ...options,
        policy: launchProcessPolicy(),
      });
      return {
        child,
        runtime: Promise.resolve(runtimeForManagedTarget(managed.target)),
        exited: managed.exited.then(lifecycleResult),
        closed: managed.closed.then(lifecycleResult),
      };
    },
    terminate: terminateProcessChild,
    async terminateRuntime(runtime, signal) {
      const target = managedTargetForRuntime(runtime);
      if ("error" in target) return refusedTermination(target.error);
      return terminateProcessTarget(target, signal);
    },
    async isRuntimeTargetAlive(runtime) {
      const target = managedTargetForRuntime(runtime);
      if ("error" in target) throw new Error(target.error);
      return isProcessTargetAlive(target);
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

export const defaultLaunchSupervisor = createLaunchSupervisor();

function runtimeForManagedTarget(target: ManagedTarget): LaunchRuntime {
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

function runtimeIdentity(identity: string): LaunchRuntimeIdentity {
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
  runtime: LaunchRuntime,
): ManagedTarget | { error: string } {
  if (runtime.platform !== process.platform) {
    return {
      error: `Cannot clean up launch spawned on ${runtime.platform} from ${process.platform}.`,
    };
  }
  return {
    pid: runtime.childPid,
    processGroupId: runtime.processGroupId,
    containment: runtime.containment,
    identity: nativeIdentityForRuntime(runtime.identity),
  };
}

function nativeIdentityForRuntime(identity: LaunchRuntimeIdentity): string {
  if (identity.kind === "linux") return `linux:${identity.startTimeTicks}`;
  if (identity.kind === "darwin") return identity.startFingerprint;
  return identity.creationDate;
}

function lifecycleResult(exit: ManagedProcessExit): ProcessLifecycleResult {
  return { kind: "closed", ...exit };
}

function refusedTermination(error: string): TerminateLaunchResult {
  return {
    attempted: false,
    terminated: false,
    method: "none",
    error,
  };
}
