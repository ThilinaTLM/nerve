import type { ExploreStepPayload } from "@nervekit/shared";
import { asRecord, stringField } from "./tool-view-helpers";
import type {
  ExploreProgressView,
  ExploreSummary,
  ExploreTaskAction,
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
          model: stringField(record.model),
          thinkingLevel: stringField(record.thinkingLevel),
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

const EXPLORE_NOISE_MESSAGES = new Set(["Final report received."]);

function friendlyExploreAction(
  update: ExploreProgressView,
): ExploreTaskAction | undefined {
  if (EXPLORE_NOISE_MESSAGES.has(update.message)) return undefined;
  switch (update.phase) {
    case "tool_call":
      return { text: update.message, mono: true };
    case "tool_result":
      return { text: update.message, mono: true };
    case "assistant":
      return { text: "Thinking\u2026", mono: false };
    case "completed":
    case "failed":
      return { text: update.message, mono: false };
    case "started":
      return update.agentId ? { text: "Started.", mono: false } : undefined;
    case "queued":
      return undefined;
  }
}

function reportStepAction(
  step: ExploreStepPayload,
): ExploreTaskAction | undefined {
  if (EXPLORE_NOISE_MESSAGES.has(step.message)) return undefined;
  return {
    text: step.type === "assistant" ? "Thinking\u2026" : step.message,
    mono: step.type !== "assistant",
  };
}

function recentTaskMessages(
  input: Pick<ExploreTaskState, "status" | "report" | "error"> & {
    updates: ExploreProgressView[];
  },
): ExploreTaskAction[] {
  const liveMessages = input.updates
    .map(friendlyExploreAction)
    .filter((action): action is ExploreTaskAction => action !== undefined);
  if (liveMessages.length > 0) return liveMessages.slice(-3);

  const stepMessages = input.report?.steps
    ?.map(reportStepAction)
    .filter((action): action is ExploreTaskAction => action !== undefined);
  if (stepMessages && stepMessages.length > 0) return stepMessages.slice(-3);

  if (input.status === "failed" && input.error) {
    return [{ text: input.error, mono: false }];
  }
  if (input.status === "completed" && input.report?.summaryPreview) {
    return [{ text: input.report.summaryPreview, mono: false }];
  }
  return [];
}

type ExploreAggregate = { tasks: ExploreTaskState[]; summary: ExploreSummary };

// `parseToolViewCached` returns a stable `view` object per tool-call revision,
// so memoizing by object identity lets the three call sites (presentation,
// dot-tone, the component) share one computation instead of recomputing the
// whole per-agent fold three times on every live delta.
const aggregateCache = new WeakMap<
  Extract<ToolView, { kind: "explore" }>,
  ExploreAggregate
>();

/**
 * Fold explore reports + streamed progress into a stable, per-agent model so the
 * transcript view stays purely presentational. Rows are index-ordered and keyed,
 * so they never reshuffle as live updates arrive. Memoized by `view` identity.
 */
export function aggregateExploreTasks(
  view: Extract<ToolView, { kind: "explore" }>,
): ExploreAggregate {
  const cached = aggregateCache.get(view);
  if (cached) return cached;
  const result = aggregateExploreTasksUncached(view);
  aggregateCache.set(view, result);
  return result;
}

function aggregateExploreTasksUncached(
  view: Extract<ToolView, { kind: "explore" }>,
): ExploreAggregate {
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
    const recentActions = updates
      .map(friendlyExploreAction)
      .filter((action): action is ExploreTaskAction => action !== undefined)
      .slice(-3);
    const latestAction = recentActions[recentActions.length - 1];
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

    const action = status === "running" ? latestAction : undefined;
    const model =
      report?.model ?? updates.find((u) => u.model)?.model ?? latest?.model;
    const thinkingLevel =
      report?.thinkingLevel ??
      updates.find((u) => u.thinkingLevel)?.thinkingLevel ??
      latest?.thinkingLevel;
    const error =
      report?.errorMessage ?? report?.summaryPreview ?? failed?.message;

    tasks.push({
      key: `task-${index}`,
      index,
      count: total || undefined,
      label: report?.label ?? latest?.label,
      task: report?.task ?? view.task,
      agentId: report?.agentId ?? latest?.agentId,
      model,
      thinkingLevel,
      status,
      currentAction: action?.text,
      currentActionMono: action?.mono ?? false,
      recentActions: status === "running" ? recentActions : [],
      recentMessages: recentTaskMessages({
        status,
        report,
        error,
        updates,
      }),
      actionCount: updates.filter((u) => u.phase === "tool_call").length,
      report,
      error,
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
