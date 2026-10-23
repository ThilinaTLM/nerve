import type { BashToolSettings } from "@nervekit/contracts/settings";
import { realpath, readFile } from "node:fs/promises";
import { projectProcessOutput } from "@nervekit/tools/result-projection";
import type { ToolHostPort } from "@nervekit/conversation-core";
import type { ToolCallOrigin } from "@nervekit/contracts/core";
import {
  toolManifest,
  buildBashToolDefinition,
  toolDefinitionByName,
  normalizeToolArguments,
  type ToolDefinition,
} from "@nervekit/tools/catalog";
import {
  createTodoHandlers,
  createToolDispatcher,
} from "@nervekit/tools/runtime";
import {
  isPathInside,
  resolveNativePath,
  type ToolExecutionContext,
} from "@nervekit/tools/execution";
import { toolNameSchema } from "@nervekit/contracts/tools";
import type { CoreProcessHost } from "./process.adapter.js";
import type { LaunchTool } from "./launch-tool.js";
import { prepareShellProcess } from "../infrastructure/process-host/shell-process.js";

export function requiresBashTimeoutArgument(
  settings: BashToolSettings,
  origin: ToolCallOrigin,
): boolean {
  return !settings.autoPromotion.enabled && origin !== "user";
}

export function createToolHostPort(
  processes: CoreProcessHost,
  captureExecution: (input: Parameters<ToolHostPort["execute"]>[0]) => Promise<
    | {
        context: ToolExecutionContext;
        bash: BashToolSettings;
        target: Record<string, unknown>;
        isCurrent?(): boolean;
      }
    | {
        kind: "configuration_blocked";
        request: import("@nervekit/contracts/core").ConfigurationBlockedRequest;
      }
  >,
  launchTool?: LaunchTool,
) {
  const todos = new Map<unknown, { todo: string; done: boolean }[]>();
  const handlers = createTodoHandlers({
    get: async (id) => todos.get(id) ?? [],
    set: async (id, value) => {
      todos.set(id, value);
      return value;
    },
  });
  if (launchTool)
    handlers.launch = (args, context) =>
      launchTool.execute(args, String(context.identity));
  // Host-only definitions (including launch) are advertised only with a registered handler.
  const baseDefinitions = toolManifest.filter(
    (tool) => tool.executionKind === "local" || tool.name in handlers,
  );
  const definitions = async (
    cwd: string,
    conversationId: string | undefined,
    capturedSettings: BashToolSettings,
  ): Promise<ToolDefinition[]> => {
    const settings = capturedSettings;
    void cwd;
    void conversationId;
    return baseDefinitions.map((tool) =>
      tool.name === "bash"
        ? {
            ...tool,
            ...buildBashToolDefinition(settings),
            agentResult: tool.agentResult,
          }
        : tool,
    );
  };
  const port: ToolHostPort = {
    isReplaySafe(name) {
      const tool = toolDefinitionByName(name);
      return (
        tool?.baseRisk === "read" &&
        !tool.traits.includes("write_capable") &&
        !tool.traits.includes("suspending")
      );
    },
    async execute(input) {
      const prepared = await port.prepareExecution!(input);
      if ("kind" in prepared)
        throw new Error("Tool execution configuration is blocked");
      return prepared.dispatch();
    },
    async prepareExecution(input) {
      while (true) {
        input.signal.throwIfAborted();
        const name = toolNameSchema.parse(input.toolName);
        const definition = baseDefinitions.find((tool) => tool.name === name);
        if (!definition) throw new Error(`Tool unavailable: ${name}`);
        const args = structuredClone(
          normalizeToolArguments(definition, structuredClone(input.args)),
        );
        const project = await realpath(input.projectDir ?? input.cwd);
        const cwd = await realpath(
          (name === "bash" || name === "python_exec") &&
            typeof args.cwd === "string"
            ? resolveNativePath(name === "bash" ? project : input.cwd, args.cwd)
            : input.cwd,
        );
        if (name === "bash" && !isPathInside(project, cwd))
          throw new Error("cwd must resolve inside the project");
        if (name === "bash" || name === "python_exec") args.cwd = cwd;
        const captured = await captureExecution({ ...input, args, cwd });
        if ("kind" in captured) return captured;
        const target = structuredClone(captured.target);
        const settings = structuredClone(captured.bash);
        const turnDefinitions = await definitions(
          input.projectDir ?? input.cwd,
          input.conversationId,
          settings,
        );
        const executionContext = {
          ...captured.context,
          cwd,
          artifactDir: input.artifactDir,
          signal: input.signal,
          onUpdate: (update: { chunk: string; stream?: string }) =>
            input.onProgress({
              chunk: update.chunk,
              ...(update.stream === "stdout" || update.stream === "stderr"
                ? { stream: update.stream }
                : {}),
            }),
        };
        const dispatcher = createToolDispatcher({
          // Canonical normalization already happened before admission; dispatch must not transform again.
          definitions: turnDefinitions.map((definition) => ({
            ...definition,
            normalizeArguments: undefined,
          })),
          advertisedToolNames: new Set(
            turnDefinitions.map((tool) => tool.name),
          ),
          hostHandlers: {
            ...handlers,
            ...(launchTool
              ? {
                  launch: (args: Record<string, unknown>) =>
                    launchTool.execute(
                      args,
                      input.conversationId,
                      input.origin,
                      input.signal,
                    ),
                }
              : {}),
          },
          contextFor: () => executionContext,
        });
        if (name === "launch" && launchTool) {
          const launch = await launchTool.prepare(
            args,
            input.conversationId,
            input.origin,
            input.signal,
            settings.shellPath,
          );
          if (captured.isCurrent?.() === false) continue;
          return {
            args,
            cwd: launch.cwd,
            target: { ...target, ...launch.target, cwd: launch.cwd },
            dispatch: () =>
              launch
                .dispatch()
                .then((result) => ({ kind: "completed" as const, result })),
          };
        }
        if (captured.isCurrent?.() === false) continue;
        if (name !== "bash")
          return {
            args,
            cwd,
            target: { ...target, cwd },
            dispatch: () =>
              dispatcher
                .execute(name, args, input.conversationId)
                .then((result) => ({ kind: "completed" as const, result })),
          };
        if (
          !args ||
          typeof args !== "object" ||
          Array.isArray(args) ||
          Object.keys(args).some(
            (key) =>
              !Object.keys(
                buildBashToolDefinition(settings).parameters.properties,
              ).includes(key),
          ) ||
          typeof args.command !== "string" ||
          (args.cwd !== undefined && typeof args.cwd !== "string") ||
          (args.background !== undefined &&
            typeof args.background !== "boolean") ||
          (args.projectEnvironment !== undefined &&
            typeof args.projectEnvironment !== "boolean") ||
          (args.ready !== undefined && typeof args.ready !== "string") ||
          (requiresBashTimeoutArgument(settings, input.origin) &&
            (!Number.isInteger(args.timeout) ||
              Number(args.timeout) < 1 ||
              Number(args.timeout) > Math.floor(settings.maxTimeoutMs / 1000)))
        )
          throw new Error("Invalid bash arguments");
        if (!String(args.command).trim())
          throw new Error("bash requires a command");
        if (args.ready !== undefined && args.background !== true)
          throw new Error("ready requires background:true");
        if (typeof args.ready === "string" && !/^https?:\/\//i.test(args.ready))
          new RegExp(args.ready);
        if (typeof args.ready === "string" && /^https?:\/\//i.test(args.ready))
          new URL(args.ready);
        if (input.signal.aborted)
          throw new DOMException("Cancelled", "AbortError");
        const preparedShell = prepareShellProcess(String(args.command), {
          shellPath: settings.shellPath,
          login: true,
          cwd,
          projectEnvironment: args.projectEnvironment,
        });
        const dispatch = async (): ReturnType<ToolHostPort["execute"]> => {
          const foregroundMs = settings.autoPromotion.enabled
            ? settings.autoPromotion.afterMs
            : null;
          if (args.background === true) {
            const started = await processes.start({
              conversationId: input.conversationId,
              command: String(args.command),
              shellPath: settings.shellPath,
              preparedShell,
              projectEnvironment: args.projectEnvironment as
                | boolean
                | undefined,
              cwd,
              artifactDir: input.artifactDir,
              signal: input.signal,
              ready:
                typeof args.ready === "string"
                  ? /^https?:\/\//i.test(args.ready)
                    ? { kind: "url", url: args.ready, timeoutMs: 60_000 }
                    : {
                        kind: "pattern",
                        pattern: args.ready,
                        timeoutMs: 60_000,
                      }
                  : undefined,
            });
            const readiness = started.readiness;
            const content = !readiness
              ? ""
              : readiness.status === "ready"
                ? readiness.url
                  ? `Ready: ${readiness.url}`
                  : "Ready: matched"
                : readiness.status === "timed_out"
                  ? "Not ready after 60s"
                  : `Exited: ${(await started.process.wait()).status}`;
            return {
              kind: "backgrounded",
              process: started.process,
              result: {
                content,
                details: {
                  launch: started.process.launch,
                  backgroundStart: true,
                  processStatusIncluded: true,
                  cwd,
                },
              },
            };
          }
          let reportProgress = true;
          const process = await processes.spawn({
            conversationId: input.conversationId,
            command: String(args.command),
            shellPath: settings.shellPath,
            preparedShell,
            projectEnvironment: args.projectEnvironment as boolean | undefined,
            cwd,
            artifactDir: input.artifactDir,
            timeoutMs: !settings.autoPromotion.enabled
              ? input.origin === "user"
                ? settings.maxTimeoutMs
                : Number(args.timeout) * 1000
              : undefined,
            onProgress: (update) => {
              if (reportProgress) input.onProgress(update);
            },
          });
          const cancel = () => {
            void process.cancel().catch(() => undefined);
          };
          input.signal.addEventListener("abort", cancel, { once: true });
          if (input.signal.aborted) cancel();
          let timer: NodeJS.Timeout | undefined;
          try {
            const outcome =
              foregroundMs === null
                ? await process.wait()
                : await Promise.race([
                    process.wait(),
                    new Promise<null>((done) => {
                      timer = setTimeout(() => done(null), foregroundMs);
                    }),
                  ]);
            if (input.signal.aborted) {
              await process.cancel();
              throw new DOMException("Cancelled", "AbortError");
            }
            if (!outcome)
              return {
                kind: "backgrounded",
                process,
                result: {
                  stdout: await readFile(process.outputFiles.stdout, "utf8"),
                  stderr: await readFile(process.outputFiles.stderr, "utf8"),
                  content: await projectProcessOutput({
                    outputFiles: process.outputFiles,
                    status: "running",
                  }),
                  details: {
                    cwd,
                    launch: process.launch,
                    processStatusIncluded: true,
                    outputFiles: process.outputFiles,
                  },
                },
              };
            const stdout = await readFile(process.outputFiles.stdout, "utf8");
            const stderr = await readFile(process.outputFiles.stderr, "utf8");
            return {
              kind: "completed",
              result: {
                stdout,
                stderr,
                exitCode: outcome.exitCode ?? undefined,
                content: await projectProcessOutput({
                  stdout,
                  stderr,
                  outputFiles: process.outputFiles,
                  status: outcome.status,
                  exitCode: outcome.exitCode,
                }),
                details: {
                  launch: process.launch,
                  exitCode: outcome.exitCode,
                  status: outcome.status,
                  processStatusIncluded: true,
                  outputFiles: process.outputFiles,
                  cwd,
                },
              },
            };
          } finally {
            reportProgress = false;
            if (timer) clearTimeout(timer);
            input.signal.removeEventListener("abort", cancel);
          }
        };
        if (captured.isCurrent?.() === false) continue;
        return {
          args: { ...args, cwd },
          cwd,
          target: {
            ...target,
            cwd,
            processLaunch: preparedShell.invocation.launch,
            projectEnvironment: args.projectEnvironment !== false,
          },
          dispatch,
        };
      }
    },
  };
  return { port, definitions };
}
