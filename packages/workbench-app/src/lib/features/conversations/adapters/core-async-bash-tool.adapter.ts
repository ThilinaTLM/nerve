import { asyncBashSchema, type AsyncBash } from "@nervekit/contracts/core";
import type { ToolView } from "$lib/presentation/tools/views/tool-view-types";
import type { TaskToolSummaryPayload } from "$lib/presentation/view-models/task";

export type AsyncBashToolView = Extract<
  ToolView,
  { kind: "task_action" | "task_status" | "task_logs" }
>;

function summary(row: AsyncBash): TaskToolSummaryPayload {
  return {
    id: row.id,
    cwd: row.workingDirectory,
    command: row.command,
    status: row.status,
    timing: {
      startedAt: row.startedAt,
      finishedAt: row.finishedAt ?? undefined,
    },
    termination: row.exitCode === null ? undefined : { exitCode: row.exitCode },
  };
}

/** Converts actual core responses into display data, without rewriting raw results. */
export function asyncBashToolView(
  toolName: string,
  result: { content?: string },
): AsyncBashToolView | undefined {
  if (
    typeof result.content !== "string" ||
    !["task_start", "task_status", "task_logs", "task_control"].includes(
      toolName,
    )
  )
    return;
  let value: unknown;
  try {
    value = JSON.parse(result.content);
  } catch {
    return;
  }
  if (toolName === "task_status") {
    const rows = asyncBashSchema.array().safeParse(value);
    if (!rows.success) return;
    return {
      kind: "task_status",
      tasks: rows.data.map(summary),
      taskCount: rows.data.length,
      hiddenTaskCount: 0,
      previewUnavailable: false,
    };
  }
  if (toolName === "task_logs") {
    if (
      !value ||
      typeof value !== "object" ||
      !("bashId" in value) ||
      typeof value.bashId !== "string" ||
      !("output" in value) ||
      typeof value.output !== "string"
    )
      return;
    return {
      kind: "task_logs",
      events: value.output ? [{ line: value.output }] : [],
      previewUnavailable: false,
    };
  }
  const started =
    toolName === "task_start" &&
    value &&
    typeof value === "object" &&
    "asyncBash" in value
      ? value
      : undefined;
  const row = asyncBashSchema.safeParse(started ? started.asyncBash : value);
  if (!row.success) return;
  const task = summary(row.data);
  if (
    started &&
    "readiness" in started &&
    started.readiness &&
    typeof started.readiness === "object" &&
    "status" in started.readiness
  ) {
    const readiness = started.readiness;
    if (
      readiness.status === "ready" ||
      readiness.status === "timed_out" ||
      readiness.status === "exited"
    ) {
      task.readiness = {
        outcome:
          readiness.status === "timed_out" ? "timeout" : readiness.status,
        readyUrl:
          readiness.status === "ready" &&
          "url" in readiness &&
          typeof readiness.url === "string"
            ? readiness.url
            : undefined,
      };
    }
  }
  return toolName === "task_start"
    ? { kind: "task_action", action: "start", task, previewUnavailable: false }
    : {
        kind: "task_action",
        action: "stop",
        task,
        outcomes: [{ task, status: task.status }],
        previewUnavailable: false,
      };
}
