import { resolve } from "node:path";
import {
  toolDefinitionByName,
  type ToolDefinition,
} from "@nervekit/tools/catalog";
import type { ConversationCore } from "../core.js";
import type { ProcessReadiness } from "../ports.js";
import type { CoreToolHandler } from "../tool-calls/core-tool.js";

function definition(name: string): ToolDefinition {
  const base = toolDefinitionByName(name);
  if (!base) throw new Error(`Missing tool definition: ${name}`);
  const schema = base.parameters;
  if (name === "task_start") {
    const properties = { ...schema.properties };
    delete properties.name;
    return {
      ...base,
      parameters: { ...schema, properties },
      description:
        "Start conversation-owned async bash. Returns its bash ID and optional readiness result; completion queues a notice. Environment overrides are passed to the host; avoid secrets in durable tool arguments.",
    };
  }
  if (name === "task_status")
    return {
      ...base,
      description:
        "List your async bash processes; tasks contains bash IDs. Defaults to running processes.",
      parameters: {
        ...schema,
        properties: {
          tasks: schema.properties.tasks,
          status: {
            type: "string",
            enum: [
              "active",
              "all",
              "running",
              "completed",
              "failed",
              "timed_out",
              "cancelled",
              "lost",
            ],
          },
        },
      },
    };
  if (name === "task_logs")
    return {
      ...base,
      description:
        "Read bounded recent output from your async bash, optionally filtered by substring.",
      parameters: {
        ...schema,
        properties: {
          task: { type: "string", description: "Bash ID" },
          contains: schema.properties.contains,
          limit: schema.properties.limit,
        },
      },
    };
  return {
    ...base,
    description: "Stop your running async bash process.",
    parameters: {
      ...schema,
      properties: {
        task: { type: "string", description: "Bash ID" },
        action: { type: "string", enum: ["stop"] },
      },
    },
  };
}

export function createAsyncBashTools(
  core: ConversationCore,
): CoreToolHandler[] {
  return ["task_start", "task_status", "task_logs", "task_control"].map(
    (name) => ({
      definition: definition(name),
      async execute(call, ctx) {
        const args = call.arguments;
        let value: unknown;
        if (name === "task_start") {
          if (typeof args.command !== "string" || !args.command.trim())
            throw new Error("A command is required");
          const snapshot = core.getSnapshot(call.conversationId);
          const project = core.projects.get(snapshot.conversation.projectId);
          if (!project) throw new Error("Project not found");
          if (args.cwd !== undefined && typeof args.cwd !== "string")
            throw new Error("Invalid working directory");
          if (
            args.env !== undefined &&
            (!args.env ||
              typeof args.env !== "object" ||
              Array.isArray(args.env) ||
              Object.values(args.env).some(
                (value) => typeof value !== "string",
              ))
          )
            throw new Error("Invalid environment overrides");
          value = await core.asyncBash.start({
            conversationId: call.conversationId,
            toolCallId: call.id,
            command: args.command,
            cwd:
              args.cwd === undefined
                ? snapshot.config.workingDirectory
                : resolve(project.directory, args.cwd),
            signal: ctx.signal,
            env: args.env as Record<string, string> | undefined,
            ready: args.ready as ProcessReadiness | undefined,
            timeoutMs: args.timeoutMs as number | undefined,
          });
        } else {
          const rows = core.asyncBash.list(call.conversationId);
          if (name === "task_status") {
            if (
              args.tasks !== undefined &&
              (!Array.isArray(args.tasks) ||
                args.tasks.some((id) => typeof id !== "string"))
            )
              throw new Error("Invalid bash IDs");
            if (
              Array.isArray(args.tasks) &&
              args.tasks.some((id) => !rows.some((row) => row.id === id))
            )
              throw new Error("Owned async bash not found");
            value = rows.filter(
              (row) =>
                (!Array.isArray(args.tasks) || args.tasks.includes(row.id)) &&
                (args.status === "all" ||
                  row.status ===
                    (args.status && args.status !== "active"
                      ? args.status
                      : "running")),
            );
          } else {
            if (
              typeof args.task !== "string" ||
              !rows.some((row) => row.id === args.task)
            )
              throw new Error("Owned async bash not found");
            if (name === "task_control") {
              if (args.action !== "stop")
                throw new Error(
                  "Only stop is supported; start a new command to restart",
                );
              await core.cancelAsyncBash(args.task);
              value = core.asyncBash
                .list(call.conversationId)
                .find((row) => row.id === args.task);
            } else {
              if (
                args.contains !== undefined &&
                typeof args.contains !== "string"
              )
                throw new Error("Invalid substring filter");
              if (
                args.limit !== undefined &&
                (!Number.isInteger(args.limit) ||
                  Number(args.limit) < 1 ||
                  Number(args.limit) > 500)
              )
                throw new Error("Invalid line limit");
              const output = await core.asyncBash.logs(
                call.conversationId,
                args.task,
              );
              const lines = output
                .split("\n")
                .filter(
                  (line) =>
                    args.contains === undefined ||
                    line.includes(String(args.contains)),
                );
              value = {
                bashId: args.task,
                output: lines.slice(-Number(args.limit ?? 100)).join("\n"),
              };
            }
          }
        }
        return {
          kind: "completed",
          result: { content: JSON.stringify(value) },
        };
      },
    }),
  );
}
