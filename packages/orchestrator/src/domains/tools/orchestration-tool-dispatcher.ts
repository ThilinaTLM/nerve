import { isAbsolute, resolve } from "node:path";
import {
  type AgentRecord,
  createId,
  type Mode,
  type TaskLogEvent,
  type TaskRecord,
  type ToolCallRecord,
} from "@nervekit/shared";
import {
  buildProcessTextResult,
  executeTool,
  type ToolExecutionContext,
  type ToolExecutionOutputUpdate,
} from "@nervekit/tools";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { ConversationRuntime } from "../conversations/conversation-runtime.js";
import type { PlanService } from "../plans/plan-service.js";
import type { PythonRuntimeService } from "../runtime/python-runtime-service.js";
import { isActiveTaskStatus } from "../tasks/index.js";
import type { TaskManager } from "../tasks/task-manager.js";
import {
  formatTaskListSummary,
  formatTaskStartSummary,
  formatTaskStatusSummary,
} from "../tasks/task-summary-format.js";
import type { InteractionSessionService } from "./interaction-session.service.js";
import {
  defaultStatusTasks as defaultStatusTasksImpl,
  enterPlanMode as enterPlanModeImpl,
  forceExitPlanMode as forceExitPlanModeImpl,
  logModeArg as logModeArgImpl,
  publishExploreProgress as publishExploreProgressImpl,
  publishToolExecutionUpdate as publishToolExecutionUpdateImpl,
  requestPlanReview as requestPlanReviewImpl,
  resolveNameMatches as resolveNameMatchesImpl,
  resolveTaskReference as resolveTaskReferenceImpl,
  selectTaskForLogs as selectTaskForLogsImpl,
  statusLogs as statusLogsImpl,
  taskCancelFromTool as taskCancelFromToolImpl,
  taskLogsFromTool as taskLogsFromToolImpl,
  tasksInScope as tasksInScopeImpl,
} from "./orchestration-tool-dispatcher-handlers.js";
import type { TodoStateService } from "./todo-state.service.js";
import { todoItemsArg, todosResult } from "./todo-state.service.js";
import {
  optionalBoundedIntegerArg,
  optionalStringArg,
  stringArg,
  stringRecordArg,
} from "./tool-args.js";
import { CodedToolError } from "./tool-errors.js";
import type {
  ExploreProgressUpdate,
  ExploreRunner,
  TaskStarter,
  ToolRequestOptions,
} from "./tool-service.js";

const DEFAULT_BASH_AUTO_PROMOTE_AFTER_MS = 60_000;
const MAX_BASH_TIMEOUT_MS = 86_400_000;

export interface OrchestrationToolDispatcherDeps {
  storage: InitializedStorage;
  events: EventBus;
  tasks: TaskManager;
  pythonRuntime: PythonRuntimeService;
  startTask: TaskStarter;
  getAgent(agentId: string): AgentRecord;
  runExplore: ExploreRunner;
  getApiKey(provider: string): Promise<string | undefined>;
  plans: PlanService;
  setAgentMode(
    agentId: string,
    mode: Mode,
    reason: string,
  ): Promise<AgentRecord>;
  conversationRuntime: ConversationRuntime;
  todoState: TodoStateService;
  interactionSessions: InteractionSessionService;
  updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord>;
  publishToolCallUpdated(toolCall: ToolCallRecord): Promise<void>;
}

export class OrchestrationToolDispatcher {
  constructor(readonly deps: OrchestrationToolDispatcherDeps) {}

  async execute(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<unknown> {
    switch (toolCall.toolName) {
      case "task_start":
        return this.startTasksFromTool(toolCall, args);
      case "task_status":
        return this.taskStatusFromTool(toolCall, args);
      case "task_logs":
        return this.taskLogsFromTool(toolCall, args);
      case "task_cancel":
        return this.taskCancelFromTool(toolCall, args);
      case "task_restart": {
        const restartedFromTaskId = this.resolveTaskReference(
          stringArg(args, "taskId"),
          toolCall,
        ).id;
        const task =
          await this.restartTaskWithStructuredErrors(restartedFromTaskId);
        const label = task.name ? `${task.name} (${task.id})` : task.id;
        return {
          task,
          tasks: [task],
          restartedFromTaskId,
          newTaskId: task.id,
          restartRootTaskId: task.restartRootTaskId,
          contentBlocks: [
            {
              type: "text",
              text: `Restarted ${restartedFromTaskId} as ${label}. Use task_status/task_logs with taskId "${task.id}".`,
            },
          ],
        };
      }
      case "task_list":
        return this.taskListFromTool(toolCall, args);
      case "explore":
        return this.deps.runExplore(
          this.deps.getAgent(toolCall.agentId),
          args,
          {
            onProgress: (message) =>
              this.publishExploreProgress(toolCall, message, options.runId),
            signal: options.signal,
          },
        );
      case "ask_user":
        return this.deps.interactionSessions.requestUserQuestion(
          toolCall,
          args,
          options,
        );
      case "todos_set": {
        const items = todoItemsArg(args);
        this.deps.todoState.set(toolCall.agentId, items);
        return todosResult(items);
      }
      case "todos_get":
        return todosResult(this.deps.todoState.get(toolCall.agentId));
      case "plan_mode_enter":
        return this.enterPlanMode(toolCall, args);
      case "plan_mode_present":
        return this.requestPlanReview(toolCall, args, options);
      case "plan_mode_force_exit":
        return this.forceExitPlanMode(toolCall, args);
      default: {
        const executionContext: ToolExecutionContext = {
          cwd: toolCall.cwd,
          signal: options.signal,
          dataDir: this.deps.storage.paths.home,
          shellPath: this.deps.storage.settings.runtime.shellPath,
          getApiKey: this.deps.getApiKey,
          getProviderConfig: async (provider) =>
            provider === "jira"
              ? this.deps.storage.settings.tools.jira
              : undefined,
          onUpdate: (update) =>
            this.publishToolExecutionUpdate(toolCall, update, options.runId),
        };
        if (toolCall.toolName === "bash" || toolCall.toolName === "python") {
          delete args.cwd;
        }
        if (
          toolCall.toolName === "bash" &&
          options.useForegroundBash !== false
        ) {
          const agent = this.deps.getAgent(toolCall.agentId);
          const promoted = await this.deps.tasks.runForegroundBashWithPromotion(
            {
              command: stringArg(args, "command"),
              cwd: toolCall.cwd,
              workerId: agent.workerId,
              projectId: toolCall.projectId,
              conversationId: toolCall.conversationId,
              agentId: toolCall.agentId,
              timeoutMs: bashTimeoutMs(args.timeout),
              autoPromoteAfterMs: DEFAULT_BASH_AUTO_PROMOTE_AFTER_MS,
              signal: options.signal,
              onOutput: executionContext.onUpdate,
              origin: {
                kind: "agent_tool",
                toolCallId: toolCall.id,
                providerToolCallId: toolCall.providerToolCallId,
                runId: toolCall.runId,
                turnId: toolCall.turnId,
                liveMessageId: toolCall.liveMessageId,
                contentIndex: toolCall.contentIndex,
              },
              continueAfterPromotion:
                options.continueAfterPromotedTask !== false,
            },
          );
          return promoted.result;
        }
        if (toolCall.toolName === "python") {
          const agent = this.deps.getAgent(toolCall.agentId);
          const runtime = await this.deps.pythonRuntime.runtimeForProject(
            agent.projectDir,
          );
          if (!runtime) throw new Error("Python runtime is not available.");
          executionContext.pythonRuntime = runtime;
          executionContext.pythonPolicy = {
            allowNetwork: true,
            allowFileWrite: agent.mode !== "planning",
          };
        }
        return executeTool(toolCall.toolName, args, executionContext);
      }
    }
  }

  async startTasksFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const batch = Array.isArray(args.tasks) ? args.tasks : undefined;
    if (batch && typeof args.command === "string") {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "Provide either 'command' or 'tasks', not both.",
      );
    }
    if (batch && batch.length > 8) {
      throw new CodedToolError(
        "TASK_BATCH_LIMIT_EXCEEDED",
        "task_start supports at most 8 tasks in one batch.",
        { maxItems: 8, received: batch.length },
      );
    }
    const inputs = batch
      ? batch.map((task) => {
          if (!task || typeof task !== "object") {
            throw new CodedToolError(
              "TASK_ARGUMENT_INVALID",
              "Each task_start batch item must be an object.",
            );
          }
          return task as Record<string, unknown>;
        })
      : [args];
    if (!batch && typeof args.command !== "string") {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "Tool argument 'command' or 'tasks' is required.",
      );
    }

    const tasks: TaskRecord[] = [];
    const groupId = createId("taskgrp");
    const groupName = optionalStringArg(args.name);
    const agent = this.deps.getAgent(toolCall.agentId);
    for (const input of inputs) {
      const command = stringArg(input, "command");
      const rawCwd =
        typeof input.cwd === "string" && input.cwd.trim().length > 0
          ? input.cwd
          : undefined;
      const cwd = rawCwd
        ? isAbsolute(rawCwd)
          ? rawCwd
          : resolve(agent.projectDir, rawCwd)
        : toolCall.cwd;
      tasks.push(
        await this.deps.startTask({
          name: typeof input.name === "string" ? input.name : undefined,
          groupId,
          groupName,
          workerId: agent.workerId,
          projectId: toolCall.projectId,
          conversationId: toolCall.conversationId,
          agentId: toolCall.agentId,
          cwd,
          command,
          env: stringRecordArg(input.env),
          readyUrl: optionalStringArg(input.readyUrl),
          readyOnUrl: Boolean(input.readyOnUrl),
          readyPattern: optionalStringArg(input.readyPattern),
          readyTimeoutMs: optionalBoundedIntegerArg(
            input.readyTimeoutMs,
            "readyTimeoutMs",
            { min: 0, max: 60_000 },
          ),
          timeoutMs: optionalBoundedIntegerArg(input.timeoutMs, "timeoutMs", {
            min: 1,
            max: 86_400_000,
          }),
          notify: typeof input.notify === "boolean" ? input.notify : true,
          origin: {
            kind: "agent_tool",
            toolCallId: toolCall.id,
            providerToolCallId: toolCall.providerToolCallId,
            runId: toolCall.runId,
            turnId: toolCall.turnId,
            liveMessageId: toolCall.liveMessageId,
            contentIndex: toolCall.contentIndex,
          },
        }),
      );
    }

    const bounded = await buildProcessTextResult({
      text: formatTaskStartSummary({ tasks, groupId, groupName }),
      outputFilePrefix: "nerve-task-start",
      exitMessagePrefix: "Task start",
      dataDir: this.deps.storage.paths.home,
      details: { groupId, groupName },
    });
    return {
      tasks,
      groupId,
      groupName,
      contentBlocks: bounded.contentBlocks,
    };
  }

  async taskStatusFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const singleTask = optionalStringArg(args.taskId);
    const taskIds = Array.isArray(args.taskIds)
      ? args.taskIds.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined;
    const groupId = optionalStringArg(args.groupId);
    const selectorCount =
      (singleTask ? 1 : 0) + (taskIds ? 1 : 0) + (groupId ? 1 : 0);
    if (selectorCount > 1) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "Provide at most one of 'taskId', 'taskIds', or 'groupId'.",
      );
    }
    if (taskIds && taskIds.length > 20) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "task_status supports at most 20 task IDs.",
        { maxItems: 20, received: taskIds.length },
      );
    }
    const limit =
      optionalBoundedIntegerArg(args.limit, "limit", { min: 1, max: 50 }) ?? 5;
    const includeLogs = args.includeLogs === true;
    const logLimit =
      optionalBoundedIntegerArg(args.logLimit, "logLimit", {
        min: 1,
        max: 50,
      }) ?? 5;
    const activeOnly = args.activeOnly === true;

    let selected: TaskRecord[];
    if (singleTask) {
      selected = [this.resolveTaskReference(singleTask, toolCall)];
    } else if (taskIds) {
      selected = taskIds.map((ref) => this.resolveTaskReference(ref, toolCall));
    } else if (groupId) {
      selected = this.tasksInScope(toolCall).filter(
        (task) =>
          task.groupId === groupId &&
          (!activeOnly || isActiveTaskStatus(task.status)),
      );
    } else {
      selected = this.defaultStatusTasks(toolCall, activeOnly, limit);
    }
    selected = selected.slice(0, limit);

    const rows: Array<{
      task: TaskRecord;
      logs?: TaskLogEvent[];
      nextCursor?: number;
    }> = [];
    for (const task of selected) {
      if (!includeLogs) {
        const cursor = await this.deps.tasks.queryLogs(task.id, {
          mode: "recent",
          limit: 1,
        });
        rows.push({ task, nextCursor: cursor.nextCursor });
        continue;
      }
      const logs = await this.statusLogs(task, logLimit);
      rows.push({ task, logs: logs.events, nextCursor: logs.nextCursor });
    }
    const bounded = await buildProcessTextResult({
      text: formatTaskStatusSummary(rows),
      outputFilePrefix: "nerve-task-status",
      exitMessagePrefix: "Task status",
      dataDir: this.deps.storage.paths.home,
    });
    return { tasks: rows, contentBlocks: bounded.contentBlocks };
  }

  async restartTaskWithStructuredErrors(taskId: string): Promise<TaskRecord> {
    try {
      return await this.deps.tasks.restartTask(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/launch env is missing|persisted keys/i.test(message)) {
        throw new CodedToolError("TASK_RESTART_ENV_MISSING", message, {
          taskId,
        });
      }
      throw error;
    }
  }

  async taskListFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const status = optionalStringArg(args.status);
    const activeOnly = args.activeOnly === true;
    const limit =
      optionalBoundedIntegerArg(args.limit, "limit", { min: 1, max: 500 }) ??
      20;
    const projectId = optionalStringArg(args.projectId) ?? toolCall.projectId;
    const conversationId = optionalStringArg(args.conversationId);
    const agentId = optionalStringArg(args.agentId);
    const groupId = optionalStringArg(args.groupId);
    let tasks = this.deps.tasks
      .listTasks()
      .filter((task) => task.projectId === projectId);
    if (conversationId) {
      tasks = tasks.filter((task) => task.conversationId === conversationId);
    }
    if (agentId) tasks = tasks.filter((task) => task.agentId === agentId);
    if (groupId) tasks = tasks.filter((task) => task.groupId === groupId);
    if (status) tasks = tasks.filter((task) => task.status === status);
    if (activeOnly)
      tasks = tasks.filter((task) => isActiveTaskStatus(task.status));
    tasks = tasks.slice(0, limit);
    const bounded = await buildProcessTextResult({
      text: formatTaskListSummary(tasks),
      outputFilePrefix: "nerve-task-list",
      exitMessagePrefix: "Task list",
      dataDir: this.deps.storage.paths.home,
    });
    return { tasks, groupId, contentBlocks: bounded.contentBlocks };
  }

  async taskCancelFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return await taskCancelFromToolImpl.call(this, toolCall, args);
  }
  async taskLogsFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return await taskLogsFromToolImpl.call(this, toolCall, args);
  }
  tasksInScope(toolCall: ToolCallRecord): TaskRecord[] {
    return tasksInScopeImpl.call(this, toolCall);
  }
  defaultStatusTasks(
    toolCall: ToolCallRecord,
    activeOnly: boolean,
    limit: number,
  ): TaskRecord[] {
    return defaultStatusTasksImpl.call(this, toolCall, activeOnly, limit);
  }
  resolveTaskReference(ref: string, toolCall: ToolCallRecord): TaskRecord {
    return resolveTaskReferenceImpl.call(this, ref, toolCall);
  }
  resolveNameMatches(
    _ref: string,
    matches: TaskRecord[],
  ): TaskRecord | undefined {
    return resolveNameMatchesImpl.call(this, _ref, matches);
  }
  async statusLogs(
    task: TaskRecord,
    limit: number,
  ): Promise<{ events: TaskLogEvent[]; nextCursor: number }> {
    return await statusLogsImpl.call(this, task, limit);
  }

  selectTaskForLogs(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): { task?: TaskRecord; autoSelected: boolean } {
    return selectTaskForLogsImpl.call(this, toolCall, args);
  }

  logModeArg(
    value: unknown,
  ):
    | "recent"
    | "errors"
    | "warnings"
    | "since_cursor"
    | "first_failure"
    | undefined {
    return logModeArgImpl.call(this, value);
  }
  publishExploreProgress(
    toolCall: ToolCallRecord,
    update: ExploreProgressUpdate,
    runId?: string,
  ): void {
    publishExploreProgressImpl.call(this, toolCall, update, runId);
  }
  publishToolExecutionUpdate(
    toolCall: ToolCallRecord,
    update: ToolExecutionOutputUpdate,
    runId?: string,
  ): void {
    publishToolExecutionUpdateImpl.call(this, toolCall, update, runId);
  }
  async requestPlanReview(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<unknown> {
    return await requestPlanReviewImpl.call(this, toolCall, args, options);
  }
  async enterPlanMode(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return await enterPlanModeImpl.call(this, toolCall, args);
  }
  async forceExitPlanMode(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return await forceExitPlanModeImpl.call(this, toolCall, args);
  }
}

function bashTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(Math.max(1, Math.ceil(value * 1000)), MAX_BASH_TIMEOUT_MS);
}
