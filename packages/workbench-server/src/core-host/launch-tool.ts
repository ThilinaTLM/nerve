import {
  projectProcessOutput,
  projectProcessOutputPage,
} from "@nervekit/tools/result-projection";
import type { Project, ToolCallOrigin } from "@nervekit/contracts/core";
import type { LaunchDefinition } from "@nervekit/contracts/launch-definitions";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import type { LaunchService } from "../domains/launches/application/launch.service.js";
import type { LaunchDefinitionService } from "../domains/launch-definitions/launch-definition.service.js";
import { isTerminalLaunchStatus } from "../domains/launches/model/launch-status.js";
import { resolveLaunchWorkingDirectory } from "../domains/launches/model/launch-working-directory.js";
import { inspectConfiguredPort } from "../domains/launches/adapters/launch-port-inspector.js";

export interface LaunchToolOptions {
  launches: Pick<
    LaunchService,
    "list" | "get" | "launchDefinition" | "restart" | "cancel"
  >;
  definitions: Pick<LaunchDefinitionService, "list" | "get">;
  project(conversationId: string): Project;
  notify(conversationId: string, launch: LaunchRecord, text: string): void;
  inspectPort?: typeof inspectConfiguredPort;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function formatLaunchStatus(
  definition: LaunchDefinition | undefined,
  launch?: LaunchRecord,
): string {
  const port = definition?.port ?? launch?.runtime?.listeningPorts?.[0]?.port;
  return [
    definition?.id ?? launch?.id,
    definition?.label ??
      definition?.command ??
      launch?.displayName ??
      launch?.command,
    launch?.status ?? "idle",
    ...(launch?.readiness.outcome === "ready" && launch.readiness.readyUrl
      ? [`ready ${launch.readiness.readyUrl}`]
      : []),
    ...(port !== undefined ? [`:${port}`] : []),
    ...(launch?.exitCode != null ? [`exit ${launch.exitCode}`] : []),
    ...(launch ? [launch.id] : []),
  ].join(" ");
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
      `${launch.id}\nStatus: ${launch.status}; exit code: ${launch.exitCode ?? "unknown"}${output ? `\n${output}` : ""}`,
    );
  }

  async execute(
    args: Record<string, unknown>,
    conversationId: string,
    origin: ToolCallOrigin = "model",
    signal?: AbortSignal,
  ) {
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
            ...(action !== "status" ? ["id"] : []),
            ...(action === "logs" ? ["offset", "limit"] : []),
          ].includes(key),
      ) ||
      (action !== "status" &&
        (typeof args.id !== "string" || !args.id.trim())) ||
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
    if (action === "status")
      return {
        content:
          [
            ...definitions.map((definition) =>
              formatLaunchStatus(
                definition,
                launches.find(
                  (launch) => launch.definitionId === definition.id,
                ),
              ),
            ),
            ...launches
              .filter((launch) => !launch.definitionId)
              .map((launch) => formatLaunchStatus(undefined, launch)),
          ].join("\n") || "No launches.",
      };
    const id = String(args.id);
    const definition = definitions.find((item) => item.id === id);
    const launch = definition
      ? launches.find((item) => item.definitionId === id)
      : launches.find((item) => item.id === id);
    if (!definition && !launch)
      throw new Error("Launch or definition not found in this project.");
    if (action === "logs") {
      if (!launch) throw new Error("Definition has no launches.");
      return {
        content: await projectProcessOutputPage({
          outputFiles: {
            combined: launch.combinedPath,
            stdout: launch.stdoutPath,
            stderr: launch.stderrPath,
          },
          status: launch.status,
          captureTruncated: launch.outputRetention?.truncated,
          offset: args.offset as number | undefined,
          limit: args.limit as number | undefined,
        }),
      };
    }
    if (action === "stop") {
      if (!launch) return { content: "Nothing running." };
      await this.options.launches.cancel(launch.id);
      return { content: `Stopped: ${launch.id}` };
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
    const definitionId = definition?.id ?? launch?.definitionId;
    if (
      action === "start" &&
      !definitionId &&
      launch &&
      !isTerminalLaunchStatus(launch.status)
    )
      return { content: `Already running: ${launch.id}` };
    this.starting++;
    try {
      let started: LaunchRecord;
      let port: number | undefined;
      if (definitionId) {
        // Re-read after stop: definition edits must take effect on restart.
        const current = await this.options.definitions.get(
          project.id,
          definitionId,
        );
        port = current.port;
        const outcome = await this.options.launches.launchDefinition({
          definitionId: current.id,
          definitionRunPolicy: current.runPolicy,
          definitionPort: port,
          projectId: project.id,
          cwd: resolveLaunchWorkingDirectory(
            current.cwd ?? project.directory,
            project.directory,
          ),
          command: current.command,
          displayName: current.label ?? current.command,
        });
        if (outcome.disposition === "focused_existing")
          return { content: `Already running: ${outcome.launch.id}` };
        if (outcome.disposition === "port_conflict")
          return {
            content: `Port conflict :${outcome.conflict.port}\n${outcome.conflict.listeners.map((listener) => `PID ${listener.pid} ${listener.processName ?? "unknown"}`).join("\n")}`,
          };
        started = outcome.launch;
      } else {
        started = await this.options.launches.restart(launch!.id);
      }
      if (origin !== "user" && !this.stopped.has(started.id)) {
        this.owners.set(started.id, conversationId);
        const exited =
          this.earlyExits.get(started.id) ??
          (await this.options.launches.get(started.id));
        if (exited && isTerminalLaunchStatus(exited.status))
          await this.changed("launch.exited", exited);
      }
      let content = `Started: ${started.id}`;
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
