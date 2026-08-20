import {
  buildProcessTextResult,
  type ToolExecutionOutputUpdate,
} from "@nervekit/tools";
import {
  type TaskCancelResultPayload,
  taskLogsToolResultSchema,
  type TaskRecord,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { ensurePlanDir } from "../plans/plan-paths.js";
import { isActiveTaskStatus, isPathInDirectoryTree } from "../tasks/index.js";
import { formatListeningPort } from "../tasks/task-port-inspector.js";
import { formatTaskLogsSummary } from "../tasks/task-summary-format.js";
import type { OrchestrationToolDispatcher } from "./orchestration-tool-dispatcher.js";
import { optionalBoundedIntegerArg, optionalStringArg } from "./tool-args.js";
import { CodedToolError } from "./tool-errors.js";
import { ToolExecutionSuspended } from "./tool-execution-suspension.js";
import type {
  ExploreProgressUpdate,
  ToolRequestOptions,
} from "./tool-service.js";

export async function taskLogsFromTool(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
): Promise<unknown> {
  const taskRef = optionalStringArg(args.taskId);
  if (!taskRef || args.groupId !== undefined || args.taskIds !== undefined) {
    throw new CodedToolError(
      "TASK_ARGUMENT_INVALID",
      "task_logs requires exactly one taskId or stable name.",
    );
  }
  const task = this.resolveTaskReference(taskRef, toolCall);
  const response = await this.deps.tasks.queryLogs(task.id, {
    mode: this.logModeArg(args.mode),
    sinceSeq: optionalBoundedIntegerArg(args.sinceSeq, "sinceSeq", {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    }),
    contains: optionalStringArg(args.contains),
    regex: optionalStringArg(args.regex),
    contextLines: optionalBoundedIntegerArg(args.contextLines, "contextLines", {
      min: 0,
      max: 20,
    }),
    limit:
      optionalBoundedIntegerArg(args.limit, "limit", {
        min: 1,
        max: 500,
      }) ?? 80,
  });
  const text = formatTaskLogsSummary({
    task: response.task,
    events: response.events,
    nextCursor: response.nextCursor,
    mode: response.mode,
  });
  const bounded = await buildProcessTextResult({
    text,
    outputFilePrefix: "nerve-task-logs",
    exitMessagePrefix: "Task logs",
    dataDir: this.deps.storage.paths.home,
    details: {
      taskId: task.id,
      mode: response.mode,
      nextCursor: response.nextCursor,
    },
  });
  const details = bounded.details as
    | { fullOutputPath?: string; truncation?: { truncated?: boolean } }
    | undefined;
  return taskLogsToolResultSchema.parse({
    ...response,
    previewPath: details?.fullOutputPath,
    truncated: details?.truncation?.truncated,
    contentBlocks: bounded.contentBlocks,
  });
}

export function tasksInScope(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
): TaskRecord[] {
  return this.deps.tasks
    .listTasks()
    .filter((task) => isPathInDirectoryTree(toolCall.cwd, task.cwd));
}

export function resolveTaskReference(
  this: OrchestrationToolDispatcher,
  ref: string,
  toolCall: ToolCallRecord,
): TaskRecord {
  const trimmed = ref.trim();
  if (trimmed.startsWith("task_")) {
    let task: TaskRecord;
    try {
      task = this.deps.tasks.getTask(trimmed);
    } catch {
      throw new CodedToolError(
        "TASK_NOT_FOUND",
        `Task '${trimmed}' not found.`,
        { ref: trimmed, taskId: trimmed },
      );
    }
    if (!isPathInDirectoryTree(toolCall.cwd, task.cwd)) {
      throw new CodedToolError(
        "TASK_OUT_OF_SCOPE",
        "Task is outside this agent's working-directory scope.",
        {
          ref: trimmed,
          taskId: task.id,
          taskCwd: task.cwd,
          scopeCwd: toolCall.cwd,
        },
      );
    }
    return task;
  }
  const scopedMatches = this.tasksInScope(toolCall).filter(
    (task) => task.name === trimmed,
  );
  const conversationMatches = scopedMatches.filter(
    (task) => task.conversationId === toolCall.conversationId,
  );
  const matches =
    conversationMatches.length > 0 ? conversationMatches : scopedMatches;
  if (matches.length === 0) {
    throw new CodedToolError("TASK_NOT_FOUND", `Task '${trimmed}' not found.`, {
      ref: trimmed,
      scopeCwd: toolCall.cwd,
      conversationId: toolCall.conversationId,
    });
  }
  const resolved = this.resolveNameMatches(trimmed, matches);
  if (resolved) return resolved;
  const details = {
    ref: trimmed,
    scopeCwd: toolCall.cwd,
    conversationId: toolCall.conversationId,
    matches: matches.slice(0, 20).map(taskReferenceDetails),
  };
  const listed = matches
    .slice(0, 8)
    .map((task) => `${task.name ?? task.id} (${task.id}, ${task.status})`)
    .join(", ");
  throw new CodedToolError(
    "TASK_NAME_AMBIGUOUS",
    `Task name '${trimmed}' is ambiguous: ${listed}. Use a task ID or groupId.`,
    details,
  );
}

export function resolveNameMatches(
  this: OrchestrationToolDispatcher,
  _ref: string,
  matches: TaskRecord[],
): TaskRecord | undefined {
  if (matches.length === 1) return matches[0];
  const activeMatches = matches.filter((task) =>
    isActiveTaskStatus(task.status),
  );
  if (activeMatches.length === 1) return activeMatches[0];

  const lineageKeys = new Set(
    matches.map((task) => task.restartRootTaskId ?? task.id),
  );
  if (lineageKeys.size === 1) return newestTask(matches);
  return undefined;
}

export function logModeArg(
  this: OrchestrationToolDispatcher,
  value: unknown,
):
  | "recent"
  | "errors"
  | "warnings"
  | "since_cursor"
  | "first_failure"
  | undefined {
  return value === "errors" ||
    value === "warnings" ||
    value === "since_cursor" ||
    value === "first_failure" ||
    value === "recent"
    ? value
    : undefined;
}

export function publishExploreProgress(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  update: ExploreProgressUpdate,
  runId?: string,
): void {
  this.liveOutput.enqueue(
    toolCall,
    {
      kind: "output",
      stream: "stdout",
      chunk: `${JSON.stringify(update)}\n`,
    },
    runId,
  );
}

export function publishToolExecutionUpdate(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  update: ToolExecutionOutputUpdate,
  runId?: string,
): Promise<void> {
  return this.liveOutput.publish(toolCall, update, runId);
}

export async function requestPlanReview(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
  options: ToolRequestOptions = {},
): Promise<unknown> {
  const existing = this.deps.plans
    .listPlanReviews()
    .find((review) => review.toolCallId === toolCall.id);
  if (existing) {
    if (existing.status !== "pending") {
      return this.deps.plans.planReviewResult(existing);
    }
    if (!options.durableSuspend) {
      return this.deps.plans.waitForPlanReviewResult(
        existing.id,
        options.signal,
      );
    }
    throw new ToolExecutionSuspended();
  }
  const review = await this.deps.plans.createPlanReview(
    toolCall,
    this.deps.getAgent(toolCall.agentId),
    args,
  );
  const requestedAt = review.requestedAt;
  const updatedToolCall = await this.deps.updateToolCall(toolCall.id, {
    result: this.deps.plans.planReviewResult(review),
    status: "waiting",
    interactions: [
      ...toolCall.interactions,
      {
        ordinal: toolCall.interactions.length,
        kind: "plan_review",
        status: "pending",
        requestedAt,
        updatedAt: requestedAt,
        request: {
          planPath: review.planPath,
          slug: review.slug,
          title: review.title,
          summary: review.summary,
          allowNewConversation: true,
        },
      },
    ],
  });
  await this.deps.publishToolCallUpdated(updatedToolCall);
  if (!options.durableSuspend) {
    const result = await this.deps.plans.waitForPlanReviewResult(
      review.id,
      options.signal,
    );
    const now = new Date().toISOString();
    const action =
      result.outcome === "accepted"
        ? "accept"
        : result.outcome === "accepted_in_new_chat"
          ? "accept_in_new_chat"
          : result.outcome === "changes_requested"
            ? "request_changes"
            : "discard";
    const resumedToolCall = await this.deps.updateToolCall(toolCall.id, {
      status: "running",
      interactions: updatedToolCall.interactions.map((interaction) =>
        interaction.kind === "plan_review" && interaction.status === "pending"
          ? {
              ...interaction,
              status: "resolved" as const,
              updatedAt: now,
              resolvedAt: now,
              resolution: { action },
            }
          : interaction,
      ),
    });
    await this.deps.publishToolCallUpdated(resumedToolCall);
    return result;
  }
  throw new ToolExecutionSuspended();
}

export async function enterPlanMode(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
): Promise<unknown> {
  const agent = this.deps.getAgent(toolCall.agentId);
  const reason =
    optionalStringArg(args.reason) ?? "Agent entered planning mode.";
  const updated =
    agent.mode === "planning"
      ? agent
      : await this.deps.setAgentMode(agent.id, "planning", reason);
  await ensurePlanDir(this.deps.storage.paths.home);
  return {
    mode: updated.mode,
    planDir: this.deps.plans.planDir(updated),
    alreadyPlanning: agent.mode === "planning",
    contentBlocks: [
      {
        type: "text",
        text: `Plan mode active. Plans are saved to ${this.deps.plans.planDir(updated)}/<feature-name>.md. Use write/edit only inside that directory, then call plan_mode_present with the plan file path when ready.`,
      },
    ],
  };
}

export async function forceExitPlanMode(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
): Promise<unknown> {
  const reason =
    optionalStringArg(args.reason) ?? "Agent exited planning mode.";
  const updated = await this.deps.plans.forceExitAgentPlanning(
    toolCall.agentId,
    reason,
  );
  return { mode: updated.mode, reason };
}

function newestTask(tasks: TaskRecord[]): TaskRecord {
  return [...tasks].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  )[0] as TaskRecord;
}

function taskReferenceDetails(task: TaskRecord): Record<string, unknown> {
  return {
    taskId: task.id,
    name: task.name,
    status: task.status,
    startedAt: task.startedAt,
    groupId: task.groupId,
    restartRootTaskId: task.restartRootTaskId ?? task.id,
    restartGeneration: task.restartGeneration,
  };
}

export function classifyCancelResult(
  before: TaskRecord,
  after: TaskRecord,
  requestedSignal: "SIGTERM" | "SIGINT" | "SIGKILL",
): TaskCancelResultPayload {
  const taskName = after.name ?? before.name;
  const label = taskName ? `${taskName} (${after.id})` : after.id;
  const releasedPorts =
    before.status === "orphaned" ? after.lastOrphanCleanupReleasedPorts : [];
  const portWarning =
    releasedPorts && releasedPorts.length > 0
      ? ` ⚠ Released listening port(s): ${releasedPorts
          .map(formatListeningPort)
          .join(", ")}.`
      : "";
  const base = {
    taskId: after.id,
    taskName,
    requestedSignal,
    status: after.status,
    releasedPorts:
      releasedPorts && releasedPorts.length > 0 ? releasedPorts : undefined,
  };

  if (before.status === "orphaned" && after.status === "cancelled") {
    return {
      ...base,
      outcome: "cancelled",
      message: `${label} orphan cleanup cancelled with ${after.signal ?? requestedSignal}.${portWarning}`,
    };
  }
  if (!isActiveTaskStatus(before.status)) {
    return {
      ...base,
      outcome: "already_terminal",
      message: `${label} was already ${before.status}; no signal was sent by this request.`,
    };
  }
  if (after.status === "cancelled") {
    const forced = after.signal === "SIGKILL" && requestedSignal !== "SIGKILL";
    return {
      ...base,
      outcome: forced ? "force_cancelled" : "cancelled",
      message: forced
        ? `${label} did not stop after ${requestedSignal}; force-cancelled with SIGKILL.${portWarning}`
        : `${label} cancelled with ${after.signal ?? requestedSignal}.${portWarning}`,
    };
  }
  if (!isActiveTaskStatus(after.status)) {
    return {
      ...base,
      outcome: "became_terminal_before_cancel",
      message: `${label} became ${after.status} before cancellation completed; no additional force kill was needed.`,
    };
  }
  return {
    ...base,
    outcome: "became_terminal_before_cancel",
    message: `${label} is still ${after.status}; cancellation did not reach a terminal state before the cancel wait ended.`,
  };
}
