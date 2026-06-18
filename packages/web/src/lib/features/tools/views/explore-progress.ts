import { asRecord, stringField } from "./tool-view-helpers";
import type {
  ExploreProgressView,
  ExploreSummary,
  ExploreTaskState,
  ExploreTaskStatus,
  ToolView,
} from "./tool-view-types";

export function parseExploreProgressLog(text: string | undefined): {
  updates: ExploreProgressView[];
  fallback?: string;
} {
  if (!text) return { updates: [] };
  const updates: ExploreProgressView[] = [];
  const fallbackLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const record = asRecord(parsed);
      if (
        record.type === "explore_progress" &&
        typeof record.timestamp === "string" &&
        typeof record.phase === "string" &&
        typeof record.message === "string"
      ) {
        updates.push({
          type: "explore_progress",
          timestamp: record.timestamp,
          agentId: stringField(record.agentId),
          taskIndex:
            typeof record.taskIndex === "number" ? record.taskIndex : undefined,
          taskCount:
            typeof record.taskCount === "number" ? record.taskCount : undefined,
          label: stringField(record.label),
          phase: record.phase as ExploreProgressView["phase"],
          message: record.message,
        });
        continue;
      }
    } catch {
      // Fall back to plain log rendering for older in-flight output.
    }
    fallbackLines.push(line);
  }
  return {
    updates,
    fallback: fallbackLines.length > 0 ? fallbackLines.join("\n") : undefined,
  };
}

const EXPLORE_NOISE_MESSAGES = new Set([
  "Assistant response started.",
  "Final report received.",
]);

function friendlyExploreAction(
  update: ExploreProgressView,
): { text: string; mono: boolean } | undefined {
  switch (update.phase) {
    case "queued":
      return undefined;
    case "started":
      return { text: "Starting\u2026", mono: false };
    case "assistant":
      return { text: "Thinking\u2026", mono: false };
    case "tool_call":
    case "tool_result":
      return { text: update.message, mono: true };
    default:
      return { text: update.message, mono: false };
  }
}

/**
 * Fold explore reports + streamed progress into a stable, per-agent model so the
 * transcript view stays purely presentational. Rows are index-ordered and keyed,
 * so they never reshuffle as live updates arrive.
 */
export function aggregateExploreTasks(
  view: Extract<ToolView, { kind: "explore" }>,
): { tasks: ExploreTaskState[]; summary: ExploreSummary } {
  const reports = view.reports;
  const byIndex = new Map<number, ExploreProgressView[]>();
  let maxSeenIndex = -1;
  let declaredCount = 0;

  for (const update of view.liveUpdates) {
    if (typeof update.taskCount === "number") {
      declaredCount = Math.max(declaredCount, update.taskCount);
    }
    if (typeof update.taskIndex !== "number") continue;
    maxSeenIndex = Math.max(maxSeenIndex, update.taskIndex);
    const bucket = byIndex.get(update.taskIndex) ?? [];
    bucket.push(update);
    byIndex.set(update.taskIndex, bucket);
  }

  const total = Math.max(
    declaredCount,
    reports.length,
    maxSeenIndex + 1,
    view.liveUpdates.length > 0 || reports.length > 0 ? 1 : 0,
  );

  const tasks: ExploreTaskState[] = [];
  for (let index = 0; index < total; index += 1) {
    const report = reports[index];
    const updates = byIndex.get(index) ?? [];
    const latest = updates[updates.length - 1];
    const lastTool = [...updates]
      .reverse()
      .find(
        (u) =>
          (u.phase === "tool_call" || u.phase === "tool_result") &&
          !EXPLORE_NOISE_MESSAGES.has(u.message),
      );
    const failed = updates.find((u) => u.phase === "failed");

    let status: ExploreTaskStatus;
    if (report?.status === "failed" || report?.status === "aborted") {
      status = "failed";
    } else if (
      report?.status === "completed" ||
      report ||
      updates.some((u) => u.phase === "completed")
    ) {
      status = "completed";
    } else if (failed) {
      status = "failed";
    } else if (
      updates.some((u) =>
        ["started", "tool_call", "tool_result", "assistant"].includes(u.phase),
      )
    ) {
      status = "running";
    } else {
      status = "queued";
    }

    const action =
      status === "running"
        ? friendlyExploreAction(lastTool ?? latest ?? updates[0])
        : undefined;

    tasks.push({
      key: `task-${index}`,
      index,
      count: total || undefined,
      label: report?.label ?? latest?.label,
      task: report?.task ?? view.task,
      agentId: report?.agentId ?? latest?.agentId,
      status,
      currentAction: action?.text,
      currentActionMono: action?.mono ?? false,
      actionCount: updates.filter((u) => u.phase === "tool_call").length,
      report,
      error: report?.errorMessage ?? report?.summaryPreview ?? failed?.message,
    });
  }

  const completed = tasks.filter((t) => t.status === "completed").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;
  const running = tasks.filter(
    (t) => t.status === "running" || t.status === "queued",
  ).length;

  return {
    tasks,
    summary: {
      total,
      completed,
      failed: failedCount,
      running,
      done: total > 0 && completed + failedCount === total,
    },
  };
}
