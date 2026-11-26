import { prepareShellProcess } from "../infrastructure/process-host/shell-process.js";
import { sleep as defaultSleep } from "@nervekit/primitives";
import {
  projectProcessOutput,
  projectProcessOutputPage,
} from "@nervekit/tools/result-projection";
import type { Project, ToolCallOrigin } from "@nervekit/contracts/core";
import type { LaunchDefinition } from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import type {
  LaunchRun,
  LaunchStartResult,
  PreparedLaunchStart,
} from "@nervekit/tools/quick-script";
import type {
  LaunchService,
  LaunchStartInput,
} from "../domains/launches/application/launch.service.js";
import { isTerminalLaunchStatus } from "../domains/launches/model/launch-status.js";
import { resolveLaunchWorkingDirectory } from "../domains/launches/model/launch-working-directory.js";
import { inspectConfiguredPort } from "../infrastructure/process-host/port-inspector.js";

export interface LaunchRunsOptions {
  launches: Pick<
    LaunchService,
    | "list"
    | "get"
    | "launchDefinition"
    | "prepareRestart"
    | "restartPrepared"
    | "cancel"
  >;
  /** Queues `text` for the conversation that started `launch`. */
  notify(conversationId: string, launch: LaunchRecord, text: string): void;
  inspectPort?: typeof inspectConfiguredPort;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** The label, or the command when there is no label: the name the user sees. */
export function definitionName(definition: LaunchDefinition): string {
  return definition.label?.trim() || definition.command.trim();
}

export function runName(launch: LaunchRecord): string {
  return (
    launch.displayName?.trim() || launch.name?.trim() || launch.command.trim()
  );
}

export function toLaunchRun(launch: LaunchRecord, name?: string): LaunchRun {
  const port = launch.runtime?.listeningPorts?.[0]?.port;
  return {
    runId: launch.id,
    name: name ?? runName(launch),
    command: launch.command,
    status: launch.status,
    ...(launch.readiness.outcome === "ready" && launch.readiness.readyUrl
      ? { readyUrl: launch.readiness.readyUrl }
      : {}),
    ...(port !== undefined ? { port } : {}),
    ...(launch.exitCode != null ? { exitCode: launch.exitCode } : {}),
    startedAt: launch.startedAt,
  };
}

/** What a start acts on: a definition (and its run to replace), or a run of no definition. */
export type LaunchStartTarget =
  | { definition: LaunchDefinition; run?: LaunchRecord }
  | { definition?: undefined; run: LaunchRecord };

/** Who asks for a start: notices of runs a model started go to its conversation. */
export type LaunchCaller = {
  conversationId: string;
  origin: ToolCallOrigin;
  signal?: AbortSignal;
};

const PORT_WAIT_MS = 30_000;

/**
 * Starts, stops and reads the runs of a project's launches for agents, and tells the conversation
 * that started a run when it exits on its own. Ownership is memory-only.
 */
export class LaunchRuns {
  private readonly owners = new Map<string, string>();
  private readonly stopped = new Set<string>();
  private readonly earlyExits = new Map<string, LaunchRecord>();
  private starting = 0;
  constructor(private readonly options: LaunchRunsOptions) {}

  list(projectId: string): Promise<LaunchRecord[]> {
    return this.options.launches.list({ projectId });
  }

  /** Called with every workbench launch event. */
  async changed(type: string, launch: LaunchRecord): Promise<void> {
    if (type === "launch.stop_requested") {
      this.owners.delete(launch.id);
      if (this.starting) this.stopped.add(launch.id);
      return;
    }
    if (!isTerminalLaunchStatus(launch.status)) return;
    const owner = this.owners.get(launch.id);
    if (!owner) {
      if (this.starting && !this.stopped.has(launch.id))
        this.earlyExits.set(launch.id, launch);
      return;
    }
    this.owners.delete(launch.id);
    if (launch.status === "cancelled") return;
    const output = await projectProcessOutput({
      outputFiles: {
        combined: launch.combinedPath,
        stdout: launch.stdoutPath,
        stderr: launch.stderrPath,
      },
      status: launch.status,
      exitCode: launch.exitCode,
      captureTruncated: launch.outputRetention?.truncated,
    });
    this.options.notify(
      owner,
      launch,
      `Launch ${JSON.stringify(runName(launch))} (run ${launch.id}, command ${JSON.stringify(launch.command)}) exited: ${launch.status}\n${output}`,
    );
  }

  /**
   * Resolves what a start or restart would run, before it is authorized. The returned `start`
   * runs exactly that command, even if the definition changes meanwhile.
   */
  async prepareStart(
    project: Project,
    target: LaunchStartTarget,
    mode: "start" | "restart",
    caller: LaunchCaller,
    shellPath: string | undefined,
  ): Promise<PreparedLaunchStart> {
    const { definition, run } = target;
    const name = definition ? definitionName(definition) : runName(run);
    if (!definition && mode === "start" && !isTerminalLaunchStatus(run.status))
      return {
        name,
        start: async () => ({
          ...toLaunchRun(run, name),
          outcome: "already_running",
        }),
      };
    const request: LaunchStartInput = definition
      ? {
          definitionId: definition.id,
          projectId: project.id,
          cwd: resolveLaunchWorkingDirectory(
            definition.cwd ?? project.directory,
            project.directory,
          ),
          command: definition.command,
          displayName: name,
        }
      : await this.options.launches.prepareRestart(run.id);
    const prepared = {
      ...request,
      env: request.env && { ...request.env },
      preparedShell: prepareShellProcess(request.command, {
        cwd: request.cwd,
        env: request.env,
        shellPath,
      }),
    };
    return {
      name,
      process: { command: prepared.command, cwd: prepared.cwd },
      start: () => this.start(project, target, mode, prepared, name, caller),
    };
  }

  private async start(
    project: Project,
    { definition, run }: LaunchStartTarget,
    mode: "start" | "restart",
    request: Parameters<LaunchRunsOptions["launches"]["restartPrepared"]>[1],
    name: string,
    caller: LaunchCaller,
  ): Promise<LaunchStartResult> {
    if (
      mode === "restart" &&
      run &&
      (definition || run.definitionId) &&
      !isTerminalLaunchStatus(run.status)
    ) {
      const stopped = await this.options.launches.cancel(run.id, {
        reason: "restart",
      });
      if (!isTerminalLaunchStatus(stopped.status))
        throw new Error(
          `Launch ${JSON.stringify(name)} is still running (run ${run.id}) and cannot be restarted; stop it, then start it.`,
        );
    }
    this.starting++;
    try {
      let started: LaunchRecord;
      if (definition) {
        const outcome = await this.options.launches.launchDefinition({
          ...request,
          definitionId: definition.id,
          projectId: project.id,
          definitionRunPolicy: definition.runPolicy,
          definitionPort: definition.port,
        });
        if (outcome.disposition === "focused_existing")
          return {
            ...toLaunchRun(outcome.launch, name),
            outcome: "already_running",
          };
        if (outcome.disposition === "port_conflict")
          throw new Error(
            `Launch ${JSON.stringify(name)} was not started: port ${outcome.conflict.port} is in use by ${outcome.conflict.listeners
              .map(
                (listener) =>
                  `PID ${listener.pid} (${listener.processName ?? "unknown"})`,
              )
              .join(
                ", ",
              )}. Do not stop foreign processes; tell the user, or stop the launch that holds the port.`,
          );
        started = outcome.launch;
      } else {
        started = await this.options.launches.restartPrepared(run.id, request);
      }
      if (caller.origin !== "user" && !this.stopped.has(started.id)) {
        this.owners.set(started.id, caller.conversationId);
        const exited =
          this.earlyExits.get(started.id) ??
          (await this.options.launches.get(started.id));
        if (exited && isTerminalLaunchStatus(exited.status))
          await this.changed("launch.exited", exited);
      }
      const port = definition?.port;
      const listening =
        port === undefined
          ? undefined
          : await this.waitForPort(port, started.id, caller.signal);
      const latest = (await this.options.launches.get(started.id)) ?? started;
      return {
        ...toLaunchRun(latest, name),
        outcome: "started",
        ...(listening !== undefined ? { listening } : {}),
      };
    } finally {
      this.starting--;
      if (!this.starting) {
        this.earlyExits.clear();
        this.stopped.clear();
      }
    }
  }

  private async waitForPort(
    port: number,
    launchId: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    const now = this.options.now ?? Date.now;
    const sleep = this.options.sleep ?? ((ms: number) => defaultSleep(ms));
    const deadline = now() + PORT_WAIT_MS;
    while (now() < deadline) {
      signal?.throwIfAborted();
      if (
        (await (this.options.inspectPort ?? inspectConfiguredPort)(port)).length
      )
        return true;
      const latest = await this.options.launches.get(launchId);
      if (latest && isTerminalLaunchStatus(latest.status)) return false;
      await sleep(Math.min(250, deadline - now()));
    }
    return false;
  }

  async stop(
    run: LaunchRecord | undefined,
    name?: string,
  ): Promise<{ stopped: boolean; run?: LaunchRun }> {
    if (!run || isTerminalLaunchStatus(run.status))
      return {
        stopped: false,
        ...(run ? { run: toLaunchRun(run, name) } : {}),
      };
    const stopped = await this.options.launches.cancel(run.id);
    return { stopped: true, run: toLaunchRun(stopped, name) };
  }

  async logs(
    run: LaunchRecord,
    page: { offset?: number; limit?: number },
    name?: string,
  ): Promise<{ run: LaunchRun; output: string }> {
    return {
      run: toLaunchRun(run, name),
      output: await projectProcessOutputPage({
        outputFiles: {
          combined: run.combinedPath,
          stdout: run.stdoutPath,
          stderr: run.stderrPath,
        },
        status: run.status,
        captureTruncated: run.outputRetention?.truncated,
        offset: page.offset,
        limit: page.limit,
      }),
    };
  }
}
