import { isAbsolute, resolve } from "node:path";
import {
  type AgentRecord,
  createId,
  type Mode,
  type TaskLogEvent,
  type TaskRecord,
  type ToolCallRecord,
} from "@nerve/shared";
import {
  buildProcessTextResult,
  executeTool,
  type ToolExecutionContext,
  type ToolExecutionOutputUpdate,
} from "@nerve/tools";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { ConversationRuntime } from "../conversations/conversation-runtime.js";
import { ensurePlanDir } from "../plans/plan-paths.js";
import type { PlanService } from "../plans/plan-service.js";
import type { PythonRuntimeService } from "../runtime/python-runtime-service.js";
import { isActiveTaskStatus } from "../tasks/index.js";
import type { TaskManager } from "../tasks/task-manager.js";
import {
  formatTaskListSummary,
  formatTaskLogsSummary,
  formatTaskStartSummary,
  formatTaskStatusSummary,
  relevantFailureLogs,
} from "../tasks/task-summary-format.js";
import type { InteractionSessionService } from "./interaction-session.service.js";
import type { TodoStateService } from "./todo-state.service.js";
import { todoItemsArg, todosResult } from "./todo-state.service.js";
import {
  optionalBoundedIntegerArg,
  optionalStringArg,
  signalArg,
  stringArg,
  stringRecordArg,
} from "./tool-args.js";
import { ToolExecutionSuspended } from "./tool-execution-suspension.js";
import type {
  ExploreProgressUpdate,
  ExploreRunner,
  TaskStarter,
  ToolRequestOptions,
} from "./tool-service.js";

const DEFAULT_BASH_AUTO_PROMOTE_AFTER_MS = 60_000;

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
  constructor(private readonly deps: OrchestrationToolDispatcherDeps) {}

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
        const task = await this.deps.tasks.restartTask(restartedFromTaskId);
        return {
          task,
          restartedFromTaskId,
          contentBlocks: [
            {
              type: "text",
              text: `Restarted ${restartedFromTaskId} as ${task.name ?? task.id}. Use task_status/task_logs with the task name or ID.`,
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
          getApiKey: this.deps.getApiKey,
          onUpdate: (update) =>
            this.publishToolExecutionUpdate(toolCall, update, options.runId),
        };
        if (toolCall.toolName === "bash" || toolCall.toolName === "python") {
          delete args.cwd;
        }
        if (toolCall.toolName === "bash") {
          const timeoutMs =
            typeof args.timeout === "number" && Number.isFinite(args.timeout)
              ? Math.max(0, args.timeout * 1000)
              : undefined;
          if (
            timeoutMs === undefined ||
            timeoutMs > DEFAULT_BASH_AUTO_PROMOTE_AFTER_MS
          ) {
            const promoted =
              await this.deps.tasks.runForegroundBashWithPromotion({
                command: stringArg(args, "command"),
                cwd: toolCall.cwd,
                timeoutMs,
                autoPromoteAfterMs: DEFAULT_BASH_AUTO_PROMOTE_AFTER_MS,
                signal: options.signal,
                origin: {
                  kind: "agent_tool",
                  toolCallId: toolCall.id,
                  providerToolCallId: toolCall.providerToolCallId,
                  runId: toolCall.runId,
                  turnId: toolCall.turnId,
                  liveMessageId: toolCall.liveMessageId,
                  contentIndex: toolCall.contentIndex,
                },
              });
            return promoted.result;
          }
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

  private async startTasksFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const batch = Array.isArray(args.tasks) ? args.tasks : undefined;
    if (batch && typeof args.command === "string") {
      throw new Error("Provide either 'command' or 'tasks', not both.");
    }
    if (batch && batch.length > 8) {
      throw new Error("task_start supports at most 8 tasks in one batch.");
    }
    const inputs = batch
      ? batch.map((task) => {
          if (!task || typeof task !== "object") {
            throw new Error("Each task_start batch item must be an object.");
          }
          return task as Record<string, unknown>;
        })
      : [args];
    if (!batch && typeof args.command !== "string") {
      throw new Error("Tool argument 'command' or 'tasks' is required.");
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

  private async taskStatusFromTool(
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
      throw new Error(
        "Provide at most one of 'taskId', 'taskIds', or 'groupId'.",
      );
    }
    if (taskIds && taskIds.length > 20) {
      throw new Error("task_status supports at most 20 task IDs.");
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

  private async taskListFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const status = optionalStringArg(args.status);
    const activeOnly = args.activeOnly === true;
    const limit =
      optionalBoundedIntegerArg(args.limit, "limit", { min: 1, max: 500 }) ??
      20;
    const projectId = optionalStringArg(args.projectId) ?? toolCall.projectId;
    const conversationId =
      optionalStringArg(args.conversationId) ?? toolCall.conversationId;
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

  private async taskCancelFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const taskRef = optionalStringArg(args.taskId);
    const groupId = optionalStringArg(args.groupId);
    if (taskRef && groupId) {
      throw new Error("Provide only one of 'taskId' or 'groupId'.");
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
      return {
        tasks: [],
        contentBlocks: [
          { type: "text", text: "No active matching tasks to cancel." },
        ],
      };
    }
    const cancelled: TaskRecord[] = [];
    for (const target of targets) {
      cancelled.push(await this.deps.tasks.cancelTask(target.id, request));
    }
    const bounded = await buildProcessTextResult({
      text: formatTaskStatusSummary(cancelled.map((task) => ({ task }))),
      outputFilePrefix: "nerve-task-cancel",
      exitMessagePrefix: "Task cancel",
      dataDir: this.deps.storage.paths.home,
    });
    return {
      task: cancelled[0],
      tasks: cancelled,
      contentBlocks: bounded.contentBlocks,
    };
  }

  private async taskLogsFromTool(
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
      contextLines: optionalBoundedIntegerArg(
        args.contextLines,
        "contextLines",
        { min: 0, max: 20 },
      ),
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

  private tasksInScope(toolCall: ToolCallRecord): TaskRecord[] {
    return this.deps.tasks
      .listTasks()
      .filter(
        (task) =>
          task.projectId === toolCall.projectId &&
          task.conversationId === toolCall.conversationId,
      );
  }

  private defaultStatusTasks(
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

  private resolveTaskReference(
    ref: string,
    toolCall: ToolCallRecord,
  ): TaskRecord {
    const trimmed = ref.trim();
    if (trimmed.startsWith("task_")) {
      const task = this.deps.tasks.getTask(trimmed);
      if (task.projectId !== toolCall.projectId) {
        throw new Error("Task is outside this agent's project scope.");
      }
      return task;
    }
    const projectMatches = this.deps.tasks
      .listTasks()
      .filter(
        (task) =>
          task.projectId === toolCall.projectId && task.name === trimmed,
      );
    const conversationMatches = projectMatches.filter(
      (task) => task.conversationId === toolCall.conversationId,
    );
    const matches =
      conversationMatches.length > 0 ? conversationMatches : projectMatches;
    if (matches.length === 0) throw new Error(`Task '${trimmed}' not found.`);
    if (matches.length > 1) {
      const listed = matches
        .slice(0, 8)
        .map((task) => `${task.name ?? task.id} (${task.id}, ${task.status})`)
        .join(", ");
      throw new Error(
        `Task name '${trimmed}' is ambiguous: ${listed}. Use a task ID or groupId.`,
      );
    }
    return matches[0] as TaskRecord;
  }

  private async statusLogs(
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

  private selectTaskForLogs(
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
      ? this.tasksInScope(toolCall).filter((task) => task.groupId === groupId)
      : this.tasksInScope(toolCall);
    const active = scoped.find((task) => isActiveTaskStatus(task.status));
    return { task: active ?? scoped[0], autoSelected: true };
  }

  private logModeArg(
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

  private publishExploreProgress(
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

  private publishToolExecutionUpdate(
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

  private async requestPlanReview(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<unknown> {
    const waitingToolCall = await this.deps.updateToolCall(toolCall.id, {
      status: "waiting_for_user",
    });
    await this.deps.publishToolCallUpdated(waitingToolCall);
    if (!options.durableSuspend) {
      return this.deps.plans.presentPlan(
        waitingToolCall,
        this.deps.getAgent(toolCall.agentId),
        args,
        options.signal,
      );
    }
    await this.deps.plans.createPlanReview(
      waitingToolCall,
      this.deps.getAgent(toolCall.agentId),
      args,
    );
    throw new ToolExecutionSuspended();
  }

  private async enterPlanMode(
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

  private async forceExitPlanMode(
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
}
