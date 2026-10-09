import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolHostPort } from "@nervekit/conversation-core";
import {
  toolManifest,
  toolDefinitionByName,
  type ToolDefinition,
} from "@nervekit/tools/catalog";
import {
  createTodoHandlers,
  createToolDispatcher,
} from "@nervekit/tools/runtime";
import type { ToolExecutionContext } from "@nervekit/tools/execution";
import { toolNameSchema } from "@nervekit/contracts/tools";
import type { CoreProcessHost } from "./process.adapter.js";

export function createToolHostPort(
  processes: CoreProcessHost,
  context: (
    cwd: string,
  ) => ToolExecutionContext | Promise<ToolExecutionContext>,
  promotionDelayMs: (cwd: string) => Promise<number | null>,
) {
  const todos = new Map<unknown, { todo: string; done: boolean }[]>();
  const handlers = createTodoHandlers({
    get: async (id) => todos.get(id) ?? [],
    set: async (id, value) => {
      todos.set(id, value);
      return value;
    },
  });
  // Conversation interactions/delegation are core-owned; launch tools do not belong to agents.
  const definitions: ToolDefinition[] = toolManifest
    .filter((tool) => tool.executionKind === "local" || tool.name in handlers)
    .map((tool) =>
      tool.name === "bash"
        ? {
            ...tool,
            description:
              "Run a shell command. Long-running commands continue as conversation-owned async bash; completion is reported to this conversation.",
          }
        : tool,
    );
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
      const name = toolNameSchema.parse(input.toolName);
      const dispatcher = createToolDispatcher({
        definitions,
        advertisedToolNames: new Set(definitions.map((tool) => tool.name)),
        hostHandlers: handlers,
        contextFor: async () => ({
          ...(await context(input.cwd)),
          cwd: input.cwd,
          artifactDir: input.artifactDir,
          signal: input.signal,
          onUpdate: (update) =>
            input.onProgress({
              chunk: update.chunk,
              ...(update.stream === "stdout" || update.stream === "stderr"
                ? { stream: update.stream }
                : {}),
            }),
        }),
      });
      if (name !== "bash")
        return {
          kind: "completed",
          result: await dispatcher.execute(
            name,
            input.args as Record<string, unknown>,
            input.conversationId,
          ),
        };
      const definition = toolDefinitionByName("bash")!;
      const args = definition.normalizeArguments
        ? definition.normalizeArguments(input.args)
        : (input.args as Record<string, unknown>);
      if (typeof args.command !== "string")
        throw new Error("bash requires a command");
      if (input.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      const foregroundMs = await promotionDelayMs(input.cwd);
      let reportProgress = true;
      const process = await processes.spawn({
        command: args.command,
        cwd:
          typeof args.cwd === "string"
            ? resolve(input.cwd, args.cwd)
            : input.cwd,
        artifactDir: input.artifactDir,
        timeoutMs:
          typeof args.timeout === "number"
            ? Math.min(86400, Math.max(1, args.timeout)) * 1000
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
              content:
                "Command continues in the background. Completion will be reported to this conversation.",
            },
          };
        const stdout = await readFile(process.outputFiles.stdout, "utf8");
        const stderr = await readFile(process.outputFiles.stderr, "utf8");
        return {
          kind: "completed",
          result: {
            content: [
              stdout.slice(-64_000),
              stderr.slice(-64_000),
              `Exit code: ${outcome.exitCode}; status: ${outcome.status}`,
            ]
              .filter(Boolean)
              .join("\n"),
            details: { exitCode: outcome.exitCode, status: outcome.status },
          },
        };
      } finally {
        reportProgress = false;
        if (timer) clearTimeout(timer);
        input.signal.removeEventListener("abort", cancel);
      }
    },
  };
  return { port, definitions: () => definitions };
}
