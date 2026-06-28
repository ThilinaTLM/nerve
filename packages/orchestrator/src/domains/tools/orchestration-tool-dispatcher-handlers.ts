import type {
  TaskCancelResultPayload,
  TaskLogEvent,
  TaskRecord,
  ToolCallRecord,
} from "@nervekit/shared";
import {
  buildProcessTextResult,
  type ToolExecutionOutputUpdate,
} from "@nervekit/tools";
import { ensurePlanDir } from "../plans/plan-paths.js";
import { isActiveTaskStatus } from "../tasks/index.js";
import { formatListeningPort } from "../tasks/task-port-inspector.js";
import {
  formatTaskCancelSummary,
  formatTaskLogsSummary,
  relevantFailureLogs,
} from "../tasks/task-summary-format.js";
import type { OrchestrationToolDispatcher } from "./orchestration-tool-dispatcher.js";
import {
  optionalBoundedIntegerArg,
  optionalStringArg,
  signalArg,
} from "./tool-args.js";
import { CodedToolError } from "./tool-errors.js";
import { ToolExecutionSuspended } from "./tool-execution-suspension.js";
import type {
  ExploreProgressUpdate,
  ToolRequestOptions,
} from "./tool-service.js";

export async function taskCancelFromTool(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
): Promise<unknown> {
  const taskRef = optionalStringArg(args.taskId);
  const groupId = optionalStringArg(args.groupId);
  if (taskRef && groupId) {
    throw new CodedToolError(
      "TASK_ARGUMENT_INVALID",
      "Provide only one of 'taskId' or 'groupId'.",
    );
  }
  const request = {
    signal: signalArg(args.signal),
    timeoutMs: optionalBoundedIntegerArg(args.timeoutMs, "timeoutMs", {
      min: 1,
      max: 30_000,
    }),
    reason: optionalStringArg(args.reason),
  };
  let targets: TaskRecord[] = [];
  let ambiguity = false;
  if (taskRef) {
    targets = [this.resolveTaskReference(taskRef, toolCall)];
  } else if (groupId) {
    targets = this.tasksInScope(toolCall).filter(
      (task) => task.groupId === groupId && isActiveTaskStatus(task.status),
    );
  } else {
    targets = this.tasksInScope(toolCall).filter((task) =>
      isActiveTaskStatus(task.status),
    );
    ambiguity = targets.length > 1;
  }
  if (ambiguity) {
    const text = [
      `Multiple active tasks found (${targets.length}); no tasks cancelled.`,
      ...targets
        .slice(0, 10)
        .map(
          (task) => `- ${task.name ?? task.id}: ${task.id} — ${task.status}`,
        ),
      "Call task_cancel with taskId/name or groupId.",
    ].join("\n");
    return { tasks: targets, contentBlocks: [{ type: "text", text }] };
  }
  if (targets.length === 0) {
    const cancelResults: TaskCancelResultPayload[] = [
      {
        outcome: "no_matching_active_task",
        requestedSignal: request.signal,
        message: "No active matching tasks to cancel.",
      },
    ];
    return {
      tasks: [],
      cancelResults,
      contentBlocks: [
        { type: "text", text: formatTaskCancelSummary(cancelResults) },
      ],
    };
  }
  const cancelled: TaskRecord[] = [];
  const cancelResults: TaskCancelResultPayload[] = [];
  const requestedSignal = request.signal ?? "SIGTERM";
  for (const target of targets) {
    const before = target;
    const after = await this.deps.tasks.cancelTask(target.id, request);
    cancelled.push(after);
    cancelResults.push(classifyCancelResult(before, after, requestedSignal));
  }
  const bounded = await buildProcessTextResult({
    text: formatTaskCancelSummary(cancelResults),
    outputFilePrefix: "nerve-task-cancel",
    exitMessagePrefix: "Task cancel",
    dataDir: this.deps.storage.paths.home,
  });
  return {
    task: cancelled[0],
    tasks: cancelled,
    cancelResults,
    contentBlocks: bounded.contentBlocks,
  };
}

export async function taskLogsFromTool(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
): Promise<unknown> {
  const selected = this.selectTaskForLogs(toolCall, args);
  if (!selected.task) {
    return {
      events: [],
      contentBlocks: [{ type: "text", text: "No matching tasks found." }],
    };
  }
  const taskId = selected.task.id;
  const response = await this.deps.tasks.queryLogs(taskId, {
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
    autoSelected: selected.autoSelected,
  });
  const bounded = await buildProcessTextResult({
    text,
    outputFilePrefix: "nerve-task-logs",
    exitMessagePrefix: "Task logs",
    dataDir: this.deps.storage.paths.home,
    details: { taskId, mode: response.mode, nextCursor: response.nextCursor },
  });
  const details = bounded.details as
    | { fullOutputPath?: string; truncation?: { truncated?: boolean } }
    | undefined;
  return {
    ...response,
    previewPath: details?.fullOutputPath,
    truncated: details?.truncation?.truncated,
    contentBlocks: bounded.contentBlocks,
  };
}

export function tasksInScope(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
): TaskRecord[] {
  return this.deps.tasks
    .listTasks()
    .filter(
      (task) =>
        task.projectId === toolCall.projectId &&
        task.conversationId === toolCall.conversationId,
    );
}

export function defaultStatusTasks(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  activeOnly: boolean,
  limit: number,
): TaskRecord[] {
  const scoped = this.tasksInScope(toolCall);
  const active = scoped.filter((task) => isActiveTaskStatus(task.status));
  if (active.length > 0) return active.slice(0, limit);
  if (activeOnly) return [];
  return scoped.slice(0, limit);
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
    if (task.projectId !== toolCall.projectId) {
      throw new CodedToolError(
        "TASK_OUT_OF_SCOPE",
        "Task is outside this agent's project scope.",
        {
          ref: trimmed,
          taskId: task.id,
          projectId: task.projectId,
          currentProjectId: toolCall.projectId,
        },
      );
    }
    return task;
  }
  const projectMatches = this.deps.tasks
    .listTasks()
    .filter(
      (task) => task.projectId === toolCall.projectId && task.name === trimmed,
    );
  const conversationMatches = projectMatches.filter(
    (task) => task.conversationId === toolCall.conversationId,
  );
  const matches =
    conversationMatches.length > 0 ? conversationMatches : projectMatches;
  if (matches.length === 0) {
    throw new CodedToolError("TASK_NOT_FOUND", `Task '${trimmed}' not found.`, {
      ref: trimmed,
      projectId: toolCall.projectId,
      conversationId: toolCall.conversationId,
    });
  }
  const resolved = this.resolveNameMatches(trimmed, matches);
  if (resolved) return resolved;
  const details = {
    ref: trimmed,
    projectId: toolCall.projectId,
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

export async function statusLogs(
  this: OrchestrationToolDispatcher,
  task: TaskRecord,
  limit: number,
): Promise<{ events: TaskLogEvent[]; nextCursor: number }> {
  if (task.status === "failed" || task.status === "timed_out") {
    const [firstFailure, errors, warnings, recent] = await Promise.all([
      this.deps.tasks.queryLogs(task.id, {
        mode: "first_failure",
        contextLines: 2,
        limit,
      }),
      this.deps.tasks.queryLogs(task.id, { mode: "errors", limit }),
      this.deps.tasks.queryLogs(task.id, { mode: "warnings", limit }),
      this.deps.tasks.queryLogs(task.id, { mode: "recent", limit }),
    ]);
    const selected = relevantFailureLogs(
      [firstFailure, errors, warnings, recent],
      limit,
    );
    return {
      events: selected.events,
      nextCursor: selected.nextCursor ?? recent.nextCursor,
    };
  }
  const recent = await this.deps.tasks.queryLogs(task.id, {
    mode: "recent",
    limit,
  });
  return { events: recent.events, nextCursor: recent.nextCursor };
}

export function selectTaskForLogs(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
): { task?: TaskRecord; autoSelected: boolean } {
  const taskRef = optionalStringArg(args.taskId);
  if (taskRef) {
    return {
      task: this.resolveTaskReference(taskRef, toolCall),
      autoSelected: false,
    };
  }
  const groupId = optionalStringArg(args.groupId);
  const scoped = groupId
    ? this.tasksInScope(toolCall).filter(
        (task: TaskRecord) => task.groupId === groupId,
      )
    : this.tasksInScope(toolCall);
  const active = scoped.find((task: TaskRecord) =>
    isActiveTaskStatus(task.status),
  );
  return { task: active ?? scoped[0], autoSelected: true };
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
  const data = this.deps.conversationRuntime.applyToolOutputDelta({
    agentId: toolCall.agentId,
    runId: runId ?? toolCall.runId,
    turnId: toolCall.turnId,
    liveMessageId: toolCall.liveMessageId,
    contentIndex: toolCall.contentIndex,
    providerToolCallId:
      toolCall.providerToolCallId ?? toolCall.sourceToolCallId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    stream: "stdout",
    delta: `${JSON.stringify(update)}\n`,
  });
  void this.deps.events.publish("conversation.live.tool_output.delta", data, {
    durability: "transient",
  });
}

export function publishToolExecutionUpdate(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  update: ToolExecutionOutputUpdate,
  runId?: string,
): void {
  if (update.kind !== "output" || update.chunk.length === 0) return;
  const data = this.deps.conversationRuntime.applyToolOutputDelta({
    agentId: toolCall.agentId,
    runId: runId ?? toolCall.runId,
    turnId: toolCall.turnId,
    liveMessageId: toolCall.liveMessageId,
    contentIndex: toolCall.contentIndex,
    providerToolCallId:
      toolCall.providerToolCallId ?? toolCall.sourceToolCallId,
    conversationId: toolCall.conversationId,
    projectId: toolCall.projectId,
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    stream: update.stream,
    delta: update.chunk,
  });
  void this.deps.events.publish("conversation.live.tool_output.delta", data, {
    durability: "transient",
  });
}

export async function requestPlanReview(
  this: OrchestrationToolDispatcher,
  toolCall: ToolCallRecord,
  args: Record<string, unknown>,
  options: ToolRequestOptions = {},
): Promise<unknown> {
  const waitingToolCall = await this.deps.updateToolCall(toolCall.id, {
    status: "waiting_for_user",
  });
  await this.deps.publishToolCallUpdated(waitingToolCall);
  const review = await this.deps.plans.createPlanReview(
    waitingToolCall,
    this.deps.getAgent(toolCall.agentId),
    args,
  );
  const updatedToolCall = await this.deps.updateToolCall(toolCall.id, {
    result: this.deps.plans.planReviewResult(review),
    status: "waiting_for_user",
  });
  await this.deps.publishToolCallUpdated(updatedToolCall);
  if (!options.durableSuspend) {
    return this.deps.plans.waitForPlanReviewResult(review.id, options.signal);
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

function classifyCancelResult(
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
