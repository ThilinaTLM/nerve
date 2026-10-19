import type { ChildProcess } from "node:child_process";
import {
  spawnManagedChildProcess,
  inspectManagedTarget,
  terminateManagedTarget,
  type ManagedTarget,
  managedProcessForChild,
  type ManagedProcessResourcePolicy,
} from "@nervekit/native";
import {
  resolveBashShellConfig,
  resolveProjectShellInvocation,
  contextualizeShellSpawnError,
} from "@nervekit/tools/execution";

export function resolveProcessShell(
  command: string,
  options: {
    cwd: string;
    env?: Record<string, string>;
    shellPath?: string;
    login?: boolean;
    projectEnvironment?: boolean;
  },
  resolution: Omit<
    NonNullable<Parameters<typeof resolveBashShellConfig>[0]>,
    "shellPath" | "env"
  > = {},
) {
  const shellConfig = resolveBashShellConfig({
    ...resolution,
    shellPath: options.shellPath,
    env: { ...process.env, ...options.env },
  });
  return resolveProjectShellInvocation(command, {
    cwd: options.cwd,
    env: {
      ...process.env,
      PAGER: "cat",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      TERM: "dumb",
      ...options.env,
    },
    shellConfig: options.login
      ? { ...shellConfig, args: ["-lc"] }
      : shellConfig,
    platform: resolution.platform,
    projectEnvironment: options.projectEnvironment,
  });
}

export function spawnShellProcess(
  command: string,
  options: {
    cwd: string;
    env?: Record<string, string>;
    shellPath?: string;
    login?: boolean;
    projectEnvironment?: boolean;
    policy: ManagedProcessResourcePolicy;
  },
) {
  const shell = resolveProcessShell(command, options);
  let child: ChildProcess;
  try {
    child = spawnManagedChildProcess(shell.shell, shell.args, {
      cwd: options.cwd,
      env: shell.env,
      policy: options.policy,
    });
  } catch (error) {
    throw contextualizeShellSpawnError(error, shell.launch);
  }
  const managed = managedProcessForChild(child);
  if (!managed)
    throw new Error("Native managed process metadata was not registered");
  return { child, managed, launch: shell.launch };
}

/** The caller owns stop intent and terminal settlement; the host owns escalation. */
export async function stopProcessTree<T>(options: {
  signal?: "SIGTERM" | "SIGINT" | "SIGKILL";
  signalProcess(
    signal: "SIGTERM" | "SIGINT" | "SIGKILL",
    escalated: boolean,
  ): Promise<unknown>;
  waitForExit(): Promise<T | "timeout">;
}): Promise<T | "timeout"> {
  await options.signalProcess(options.signal ?? "SIGTERM", false);
  let evidence = await options.waitForExit();
  if (evidence === "timeout" && options.signal !== "SIGKILL") {
    await options.signalProcess("SIGKILL", true);
    evidence = await options.waitForExit();
  }
  return evidence;
}

export async function waitForProcessExit<T>(
  exited: Promise<T>,
  timeoutMs: number,
): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function terminateProcessChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
) {
  const managed = managedProcessForChild(child);
  if (!managed)
    return {
      attempted: false,
      terminated: false,
      method: "none" as const,
      error: "Child is not owned by the native managed process runtime",
    };
  return managed.terminate(signal);
}

export async function terminateProcessTarget(
  target: ManagedTarget,
  signal: NodeJS.Signals,
) {
  return terminateManagedTarget(target, signal);
}

export function isProcessTargetAlive(target: ManagedTarget): boolean {
  const inspection = inspectManagedTarget(target);
  if (inspection.evidence === "alive_verified") return true;
  if (
    inspection.evidence === "exited_verified" ||
    inspection.evidence === "identity_mismatch"
  )
    return false;
  throw new Error(inspection.detail);
}
