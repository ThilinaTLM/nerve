import { isAbsolute, resolve } from "node:path";
import type {
  AgentRecord,
  Mode,
  TaskLogEvent,
  TaskRecord,
  ToolCallRecord,
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
import type { TaskManager } from "../tasks/task-manager.js";
import type { InteractionSessionService } from "./interaction-session.service.js";
import type { TodoStateService } from "./todo-state.service.js";
import { todoItemsArg, todosResult } from "./todo-state.service.js";
import {
  optionalBoundedIntegerArg,
  optionalStringArg,
  signalArg,
  stringArg,
  stringRecordArg,
  taskIdArg,
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
      case "task_cancel": {
        const task = await this.deps.tasks.cancelTask(
          taskIdArg(args, this.deps.tasks, toolCall.projectId),
          {
            signal: signalArg(args.signal),
            timeoutMs: optionalBoundedIntegerArg(args.timeoutMs, "timeoutMs", {
              min: 1,
              max: 30_000,
            }),
            reason: optionalStringArg(args.reason),
          },
        );
        return {
          task,
          contentBlocks: [
            {
              type: "text",
              text: `Task ${task.id} is ${task.status}. Use task_status/task_logs for current details.`,
            },
          ],
        };
      }
      case "task_restart": {
        const restartedFromTaskId = taskIdArg(
          args,
          this.deps.tasks,
          toolCall.projectId,
        );
        const task = await this.deps.tasks.restartTask(restartedFromTaskId);
        return {
          task,
          restartedFromTaskId,
          contentBlocks: [
            {
              type: "text",
              text: `Restarted ${restartedFromTaskId} as ${task.id}. Use task_status/task_logs with the full task ID.`,
            },
          ],
        };
      }
      case "task_list": {
        const status = optionalStringArg(args.status);
        const activeOnly = args.activeOnly === true;
        const limit =
          optionalBoundedIntegerArg(args.limit, "limit", {
            min: 1,
            max: 500,
          }) ?? 100;
        const activeStatuses = new Set([
          "starting",
          "running",
          "ready",
          "stopping",
        ]);
        const projectId =
          optionalStringArg(args.projectId) ?? toolCall.projectId;
        const conversationId = optionalStringArg(args.conversationId);
        const agentId = optionalStringArg(args.agentId);
        let tasks = this.deps.tasks
          .listTasks()
          .filter((task) => task.projectId === projectId);
        if (conversationId)
          tasks = tasks.filter(
            (task) => task.conversationId === conversationId,
          );
        if (agentId) tasks = tasks.filter((task) => task.agentId === agentId);
        if (status) tasks = tasks.filter((task) => task.status === status);
        if (activeOnly)
          tasks = tasks.filter((task) => activeStatuses.has(task.status));
        tasks = tasks.slice(0, Math.max(1, Math.min(500, limit)));
        const bounded = await buildProcessTextResult({
          text: this.formatTaskListSummary(tasks),
          outputFilePrefix: "nerve-task-list",
          exitMessagePrefix: "Task list",
          dataDir: this.deps.storage.paths.home,
        });
        return {
          tasks,
          contentBlocks: bounded.contentBlocks,
        };
      }
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
          workerId: agent.workerId,
          projectId: toolCall.projectId,
          conversationId: toolCall.conversationId,
          agentId: toolCall.agentId,
          cwd,
          command,
          env: stringRecordArg(input.env),
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
          injectCompletion:
            typeof input.injectCompletion === "boolean"
              ? input.injectCompletion
              : true,
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

    return {
      tasks,
      contentBlocks: [
        {
          type: "text",
          text: `Started ${tasks.length} background ${tasks.length === 1 ? "task" : "tasks"}: ${tasks
            .map((task) => task.id)
            .join(
              ", ",
            )}. Use task_status/task_logs/task_cancel with the full task IDs.`,
        },
      ],
    };
  }

  private async taskStatusFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const singleTaskId =
      typeof args.taskId === "string" ? args.taskId : undefined;
    const taskIds = Array.isArray(args.taskIds)
      ? args.taskIds.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined;
    if ((singleTaskId ? 1 : 0) + (taskIds ? 1 : 0) !== 1) {
      throw new Error("Provide exactly one of 'taskId' or 'taskIds'.");
    }
    if (taskIds && taskIds.length > 20) {
      throw new Error("task_status supports at most 20 task IDs.");
    }
    const ids = singleTaskId ? [singleTaskId] : (taskIds ?? []);
    const includeLogs = args.includeLogs === true;
    const logLimit =
      optionalBoundedIntegerArg(args.logLimit, "logLimit", {
        min: 1,
        max: 50,
      }) ?? 20;
    const tasks = [] as Array<{
      task: TaskRecord;
      recentLogs?: TaskLogEvent[];
    }>;
    for (const rawId of ids) {
      const taskId = taskIdArg(
        { taskId: rawId },
        this.deps.tasks,
        toolCall.projectId,
      );
      const task = this.deps.tasks.getTask(taskId);
      if (!includeLogs) {
        tasks.push({ task });
        continue;
      }
      const logs = await this.deps.tasks.queryLogs(taskId, {
        mode: "recent",
        limit: logLimit,
      });
      tasks.push({ task, recentLogs: logs.events });
    }
    const text = this.formatTaskStatusSummary(tasks);
    const bounded = await buildProcessTextResult({
      text,
      outputFilePrefix: "nerve-task-status",
      exitMessagePrefix: "Task status",
      dataDir: this.deps.storage.paths.home,
    });
    return { tasks, contentBlocks: bounded.contentBlocks };
  }

  private async taskLogsFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const taskId = taskIdArg(args, this.deps.tasks, toolCall.projectId);
    const response = await this.deps.tasks.queryLogs(taskId, {
      mode:
        args.mode === "errors" ||
        args.mode === "warnings" ||
        args.mode === "since_cursor" ||
        args.mode === "first_failure" ||
        args.mode === "recent"
          ? args.mode
          : undefined,
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
      limit: optionalBoundedIntegerArg(args.limit, "limit", {
        min: 1,
        max: 500,
      }),
    });
    const text = this.formatTaskLogs(
      response.task,
      response.events,
      response.nextCursor,
    );
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

  private formatTaskListSummary(tasks: TaskRecord[]): string {
    if (tasks.length === 0) return "No tasks found.";
    return tasks
      .map((task) => `${task.id} — ${task.status} — ${task.command}`)
      .join("\n");
  }

  private formatTaskStatusSummary(
    tasks: Array<{ task: TaskRecord; recentLogs?: TaskLogEvent[] }>,
  ): string {
    return tasks
      .map(({ task, recentLogs }) => {
        const lines = [
          `${task.id}: ${task.status}`,
          `Command: ${task.command}`,
          `Cwd: ${task.cwd}`,
        ];
        if (task.exitCode !== undefined)
          lines.push(`Exit code: ${task.exitCode}`);
        if (task.signal) lines.push(`Signal: ${task.signal}`);
        if (task.error) lines.push(`Error: ${task.error}`);
        if (task.readiness.outcome !== "none") {
          lines.push(
            `Readiness: ${task.readiness.outcome}${task.readiness.matched ? ` (${task.readiness.matched})` : ""}`,
          );
        }
        if (recentLogs && recentLogs.length > 0) {
          lines.push("Recent logs:");
          lines.push(...recentLogs.map((log) => this.formatLogEvent(log)));
          lines.push(`Use task_logs with taskId "${task.id}" for more output.`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  }

  private formatTaskLogs(
    task: TaskRecord,
    events: TaskLogEvent[],
    nextCursor: number,
  ): string {
    const lines = [
      `Logs for ${task.id} (${task.status})`,
      `Command: ${task.command}`,
      `nextCursor: ${nextCursor}`,
      "",
    ];
    if (events.length === 0) {
      lines.push("No matching log events.");
    } else {
      lines.push(...events.map((event) => this.formatLogEvent(event)));
    }
    lines.push(
      "",
      `Use task_logs with mode "since_cursor" and sinceSeq ${nextCursor} to continue.`,
    );
    return lines.join("\n");
  }

  private formatLogEvent(event: TaskLogEvent): string {
    return `[${event.seq} ${event.stream} ${event.level}] ${event.line}`;
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
