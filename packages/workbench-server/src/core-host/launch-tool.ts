import { canonicalDigest } from "./execution-admission/admission.js";
import { prepareShellProcess } from "../infrastructure/process-host/shell-process.js";
import {
  projectProcessOutput,
  projectProcessOutputPage,
} from "@nervekit/tools/result-projection";
import type { Project, ToolCallOrigin } from "@nervekit/contracts/core";
import type { LaunchDefinition } from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import type {
  LaunchService,
  LaunchStartInput,
  PreparedLaunchStartInput,
} from "../domains/launches/application/launch.service.js";
import type { LaunchDefinitionService } from "../domains/launch-definitions/launch-definition.service.js";
import { isTerminalLaunchStatus } from "../domains/launches/model/launch-status.js";
import { resolveLaunchWorkingDirectory } from "../domains/launches/model/launch-working-directory.js";
import { inspectConfiguredPort } from "../infrastructure/process-host/port-inspector.js";

export interface LaunchToolOptions {
  launches: Pick<
    LaunchService,
    | "list"
    | "get"
    | "launchDefinition"
    | "prepareRestart"
    | "restartPrepared"
    | "cancel"
  >;
  definitions: Pick<LaunchDefinitionService, "list" | "get">;
  project(conversationId: string): Project;
  notify(conversationId: string, launch: LaunchRecord, text: string): void;
  inspectPort?: typeof inspectConfiguredPort;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function definitionName(definition: LaunchDefinition): string {
  return definition.label?.trim() || definition.command.trim();
}

function launchName(launch: LaunchRecord): string {
  return (
    launch.displayName?.trim() || launch.name?.trim() || launch.command.trim()
  );
}

function launchDescription(
  definition: LaunchDefinition | undefined,
  launch?: LaunchRecord,
): string {
  const name = definition ? definitionName(definition) : launchName(launch!);
  const command = definition?.command ?? launch!.command;
  return `${JSON.stringify(name)} — command: ${JSON.stringify(command)}${launch && launch.command !== command ? `; run command: ${JSON.stringify(launch.command)}` : ""}${launch ? `; runId: ${launch.id}` : ""}`;
}

export function formatLaunchStatus(
  definition: LaunchDefinition | undefined,
  launch?: LaunchRecord,
): string {
  const port = definition?.port ?? launch?.runtime?.listeningPorts?.[0]?.port;
  return [
    launchDescription(definition, launch),
    launch?.status ?? "idle",
    ...(launch?.readiness.outcome === "ready" && launch.readiness.readyUrl
      ? [`ready ${launch.readiness.readyUrl}`]
      : []),
    ...(port !== undefined ? [`:${port}`] : []),
    ...(launch?.exitCode != null ? [`exit ${launch.exitCode}`] : []),
  ].join(" ");
}

type LaunchSelection = { definition?: LaunchDefinition; launch?: LaunchRecord };
interface LaunchSnapshot {
  project: Project;
  definitions: LaunchDefinition[];
  launches: LaunchRecord[];
  selection?: LaunchSelection;
  start?: PreparedLaunchStartInput;
}
function selectLaunch(
  args: Record<string, unknown>,
  definitions: LaunchDefinition[],
  launches: LaunchRecord[],
): LaunchSelection {
  const definitionIds = new Set(definitions.map((item) => item.id));
  const isStandalone = (launch: LaunchRecord) =>
    !launch.definitionId || !definitionIds.has(launch.definitionId);
  const name = String(args.name).trim();
  const matchingDefinitions = definitions.filter(
    (item) => definitionName(item) === name,
  );
  if (matchingDefinitions.length > 1)
    throw new Error(
      `Ambiguous launch name ${JSON.stringify(name)}. Rename the duplicate definitions: ${matchingDefinitions.map((item) => JSON.stringify(item.command)).join(", ")}`,
    );
  const definition = matchingDefinitions[0];
  const matchingLaunches = definition
    ? launches.filter((item) => item.definitionId === definition.id)
    : launches.filter(
        (item) => isStandalone(item) && launchName(item) === name,
      );
  const runId =
    args.runId === undefined ? undefined : String(args.runId).trim();
  const lineages = new Set(
    matchingLaunches.map((item) => item.restartRootLaunchId ?? item.id),
  );
  if (!definition && !runId && lineages.size > 1)
    throw new Error(
      `Ambiguous launch name ${JSON.stringify(name)}. Supply runId for a specific execution: ${matchingLaunches.map((item) => `${item.id} (${JSON.stringify(item.command)})`).join(", ")}`,
    );
  const launch = runId
    ? matchingLaunches.find((item) => item.id === runId)
    : matchingLaunches[0];
  if (runId && !launch)
    throw new Error("Launch run not found for this name in this project.");
  if (!definition && !launch)
    throw new Error("Launch name not found in this project.");
  return { definition, launch };
}

export class LaunchTool {
  private readonly owners = new Map<string, string>();
  private readonly stopped = new Set<string>();
  private readonly earlyExits = new Map<string, LaunchRecord>();
  private starting = 0;
  constructor(private readonly options: LaunchToolOptions) {}

  // Called from workbench launch events; ownership and early-exit bookkeeping are memory-only.
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
      `${launchDescription(undefined, launch)}\n${output}`,
    );
  }

  async execute(
    args: Record<string, unknown>,
    conversationId: string,
    origin: ToolCallOrigin = "model",
    signal?: AbortSignal,
  ) {
    return (
      await this.prepare(args, conversationId, origin, signal)
    ).dispatch();
  }
  async prepare(
    args: Record<string, unknown>,
    conversationId: string,
    origin: ToolCallOrigin = "model",
    signal?: AbortSignal,
    shellPath?: string,
  ) {
    args = structuredClone(args);
    const action = args?.action;
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      !["status", "logs", "start", "restart", "stop"].includes(
        String(action),
      ) ||
      Object.keys(args).some(
        (key) =>
          ![
            "action",
            ...(action !== "status" ? ["name"] : []),
            ...(["logs", "stop", "restart"].includes(String(action))
              ? ["runId"]
              : []),
            ...(action === "logs" ? ["offset", "limit"] : []),
          ].includes(key),
      ) ||
      (action !== "status" &&
        (typeof args.name !== "string" || !args.name.trim())) ||
      (args.runId !== undefined &&
        (typeof args.runId !== "string" || !args.runId.trim())) ||
      (args.offset !== undefined &&
        (!Number.isInteger(args.offset) || Number(args.offset) < 0)) ||
      (args.limit !== undefined &&
        (!Number.isInteger(args.limit) ||
          Number(args.limit) < 1 ||
          Number(args.limit) > 500))
    )
      throw new Error("Invalid launch arguments");
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const project = this.options.project(conversationId);
    const definitions = await this.options.definitions.list(project.id);
    const launches = await this.options.launches.list({
      projectId: project.id,
    });
    const snapshot: LaunchSnapshot = structuredClone({
      project,
      definitions,
      launches,
    });
    if (action !== "status")
      snapshot.selection = selectLaunch(
        args,
        snapshot.definitions,
        snapshot.launches,
      );
    if (action === "start" || action === "restart") {
      const { definition, launch } = snapshot.selection!;
      let request: LaunchStartInput | undefined;
      if (definition)
        request = {
          definitionId: definition.id,
          projectId: project.id,
          cwd: resolveLaunchWorkingDirectory(
            definition.cwd ?? project.directory,
            project.directory,
          ),
          command: definition.command,
          displayName: definitionName(definition),
        };
      else if (action === "restart" || isTerminalLaunchStatus(launch!.status))
        request = await this.options.launches.prepareRestart(launch!.id);
      if (request) {
        request = { ...request, env: request.env && { ...request.env } };
        snapshot.start = {
          ...request,
          preparedShell: prepareShellProcess(request.command, {
            cwd: request.cwd,
            env: request.env,
            shellPath,
          }),
        };
      }
    }
    const request = snapshot.start;
    const digest = canonicalDigest(
      JSON.parse(
        JSON.stringify({
          definitions: snapshot.definitions,
          launches: snapshot.launches.map(
            ({ id, command, cwd, definitionId, restartRootLaunchId }) => ({
              id,
              command,
              cwd,
              definitionId,
              restartRootLaunchId,
            }),
          ),
          // Bind actual restart inputs too; env values may contain credentials and are transient only.
          request: request
            ? {
                command: request.command,
                cwd: request.cwd,
                definitionId: request.definitionId ?? null,
                projectId: request.projectId ?? null,
                restartedFromLaunchId: request.restartedFromLaunchId ?? null,
                restartRootLaunchId: request.restartRootLaunchId ?? null,
                restartGeneration: request.restartGeneration ?? 0,
                timeoutMs: request.timeoutMs ?? null,
                readiness: {
                  url: request.readyUrl ?? null,
                  onUrl: request.readyOnUrl ?? null,
                  pattern: request.readyPattern ?? null,
                  timeoutMs: request.readyTimeoutMs ?? null,
                },
                environmentSource: request.restartedFromLaunchId ?? null,
                environmentKeys: Object.keys(request.env ?? {}).sort(),
              }
            : null,
        }),
      ),
    );
    return {
      cwd: request?.cwd ?? project.directory,
      target: {
        launchConfigurationDigest: digest,
        ...(request
          ? {
              processLaunch: request.preparedShell.invocation.launch,
              projectEnvironment: true,
            }
          : {}),
      },
      dispatch: () =>
        this.executePrepared(args, conversationId, origin, signal, snapshot),
    };
  }
  private async executePrepared(
    args: Record<string, unknown>,
    conversationId: string,
    origin: ToolCallOrigin,
    signal: AbortSignal | undefined,
    snapshot: LaunchSnapshot,
  ) {
    const action = args.action;
    const { definitions, launches } = snapshot;
    const definitionIds = new Set(definitions.map((item) => item.id));
    const isStandalone = (launch: LaunchRecord) =>
      !launch.definitionId || !definitionIds.has(launch.definitionId);
    if (action === "status")
      return {
        content:
          [
            ...definitions.flatMap((definition) => {
              const runs = launches.filter(
                (launch) => launch.definitionId === definition.id,
              );
              return runs.length
                ? runs.map((launch) => formatLaunchStatus(definition, launch))
                : [formatLaunchStatus(definition)];
            }),
            ...launches
              .filter(isStandalone)
              .map((launch) => formatLaunchStatus(undefined, launch)),
          ].join("\n") || "No launches.",
      };
    const { definition, launch } = snapshot.selection!;
    if (action === "logs") {
      if (!launch) throw new Error("Definition has no launches.");
      return {
        content: `${launchDescription(definition, launch)}\n${await projectProcessOutputPage(
          {
            outputFiles: {
              combined: launch.combinedPath,
              stdout: launch.stdoutPath,
              stderr: launch.stderrPath,
            },
            status: launch.status,
            captureTruncated: launch.outputRetention?.truncated,
            offset: args.offset as number | undefined,
            limit: args.limit as number | undefined,
          },
        )}`,
      };
    }
    if (action === "stop") {
      if (!launch)
        return { content: `Nothing running: ${launchDescription(definition)}` };
      await this.options.launches.cancel(launch.id);
      return { content: `Stopped: ${launchDescription(definition, launch)}` };
    }
    if (
      action === "restart" &&
      launch &&
      (definition || launch.definitionId) &&
      !isTerminalLaunchStatus(launch.status)
    ) {
      const stopped = await this.options.launches.cancel(launch.id, {
        reason: "restart",
      });
      if (!isTerminalLaunchStatus(stopped.status))
        throw new Error("Launch is still running and cannot be restarted");
    }
    const definitionId = definition?.id;
    if (
      action === "start" &&
      !definitionId &&
      launch &&
      !isTerminalLaunchStatus(launch.status)
    )
      return {
        content: `Already running: ${launchDescription(definition, launch)}`,
      };
    this.starting++;
    try {
      let started: LaunchRecord;
      let port: number | undefined;
      let startedDefinition: LaunchDefinition | undefined;
      if (definitionId) {
        const current = definition;
        startedDefinition = current;
        port = current.port;
        const outcome = await this.options.launches.launchDefinition({
          ...snapshot.start!,
          definitionId: current.id,
          projectId: snapshot.project.id,
          definitionRunPolicy: current.runPolicy,
          definitionPort: port,
        });
        if (outcome.disposition === "focused_existing")
          return {
            content: `Already running: ${launchDescription(current, outcome.launch)}`,
          };
        if (outcome.disposition === "port_conflict")
          return {
            content: `${launchDescription(current)}\nPort conflict :${outcome.conflict.port}\n${outcome.conflict.listeners.map((listener) => `PID ${listener.pid} ${listener.processName ?? "unknown"}`).join("\n")}`,
          };
        started = outcome.launch;
      } else {
        started = await this.options.launches.restartPrepared(
          launch!.id,
          snapshot.start!,
        );
      }
      if (origin !== "user" && !this.stopped.has(started.id)) {
        this.owners.set(started.id, conversationId);
        const exited =
          this.earlyExits.get(started.id) ??
          (await this.options.launches.get(started.id));
        if (exited && isTerminalLaunchStatus(exited.status))
          await this.changed("launch.exited", exited);
      }
      let content = `Started: ${launchDescription(startedDefinition, started)}`;
      if (port !== undefined) {
        const now = this.options.now ?? Date.now;
        const deadline = now() + 30_000;
        let ready = false;
        while (now() < deadline) {
          if (signal?.aborted)
            throw new DOMException("Cancelled", "AbortError");
          if (
            (await (this.options.inspectPort ?? inspectConfiguredPort)(port))
              .length
          ) {
            ready = true;
            break;
          }
          const latest = await this.options.launches.get(started.id);
          if (latest && isTerminalLaunchStatus(latest.status)) break;
          await (
            this.options.sleep ??
            ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
          )(Math.min(250, deadline - now()));
        }
        content += `\n${ready ? `Ready :${port}` : "Not listening after 30s"}`;
      }
      return { content };
    } finally {
      this.starting--;
      if (!this.starting) {
        this.earlyExits.clear();
        this.stopped.clear();
      }
    }
  }
}
