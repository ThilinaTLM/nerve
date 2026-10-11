import { toolDefinitionByName } from "@nervekit/tools/catalog";
import type { ConversationCore } from "../core.js";
import type { CoreToolHandler } from "../tool-calls/core-tool.js";

export function validateAsyncBashArguments(
  args: Record<string, unknown>,
): void {
  const allowed =
    args.action === "list"
      ? ["action", "all"]
      : args.action === "logs"
        ? ["action", "id", "offset", "limit"]
        : args.action === "stop"
          ? ["action", "id"]
          : [];
  if (
    !allowed.length ||
    Object.keys(args).some((key) => !allowed.includes(key))
  )
    throw new Error("Invalid async_bash action or arguments");
  if (args.action !== "list" && (typeof args.id !== "string" || !args.id))
    throw new Error("A bash ID is required");
  if (args.all !== undefined && typeof args.all !== "boolean")
    throw new Error("Invalid all flag");
  if (
    args.offset !== undefined &&
    (!Number.isInteger(args.offset) || Number(args.offset) < 0)
  )
    throw new Error("Invalid line offset");
  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) ||
      Number(args.limit) < 1 ||
      Number(args.limit) > 500)
  )
    throw new Error("Invalid line limit");
}

export function createAsyncBashTools(
  core: ConversationCore,
): CoreToolHandler[] {
  return [
    {
      definition: toolDefinitionByName("async_bash")!,
      async execute(call) {
        const args = call.arguments;
        validateAsyncBashArguments(args);
        const rows = core.asyncBash.list(call.conversationId);
        let content: string;
        if (args.action === "list") {
          const selected = rows.filter(
            (row) => args.all === true || row.status === "running",
          );
          content =
            selected
              .map((row) => {
                const duration = Math.max(
                  0,
                  Math.round(
                    ((row.finishedAt
                      ? Date.parse(row.finishedAt)
                      : Date.now()) -
                      Date.parse(row.startedAt)) /
                      1000,
                  ),
                );
                const command = row.command.replace(/\s+/g, " ").slice(0, 80);
                return `${row.id} ${row.status}${row.exitCode === null ? "" : ` exit ${row.exitCode}`} ${duration}s ${command}`;
              })
              .join("\n") || "No running async bash.";
        } else {
          const row = rows.find((row) => row.id === args.id);
          if (!row) throw new Error("Owned async bash not found");
          if (args.action === "logs") {
            content = await core.asyncBash.logs(call.conversationId, row.id, {
              offset: args.offset as number | undefined,
              limit: args.limit as number | undefined,
            });
          } else {
            await core.cancelAsyncBash(row.id);
            content = `${row.id} ${core.asyncBash.list(call.conversationId).find((item) => item.id === row.id)?.status ?? "cancelled"}`;
          }
        }
        return { kind: "completed", result: { content } };
      },
    },
  ];
}
