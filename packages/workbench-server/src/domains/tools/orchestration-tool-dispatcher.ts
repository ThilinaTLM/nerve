import { isAbsolute, resolve } from "node:path";
import {
  buildProcessTextResult,
  createExploreHandlers,
  createHostToolFactory,
  type HostToolFactory,
  createInteractionHandlers,
  createPlanHandlers,
  createTaskHandlers,
  createTodoHandlers,
  type ToolExecutionContext,
  type ToolExecutionOutputUpdate,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
  toolDefinitionByName,
} from "@nervekit/host-runtime/tools";
import {
  type AgentRecord,
  type ConversationRuntime,
  type Mode,
  taskRestartToolResultSchema,
  taskStartToolResultSchema,
  taskStatusToolResultSchema,
  type TaskRecord,
  type TaskStatus,
  type ToolCallRecord,
  type ToolName,
} from "@nervekit/contracts";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { PlanService } from "../plans/plan-service.js";
import type { PythonRuntimeService } from "../runtime/python-runtime-service.js";
import { isActiveTaskStatus } from "../tasks/index.js";
import type { WorkbenchTaskService } from "../tasks/workbench-task-service.js";
import {
  formatTaskStartSummary,
  formatTaskStatusSummary,
} from "../tasks/task-summary-format.js";
import type { InteractionSessionService } from "./interaction-session.service.js";
import {
  enterPlanMode as enterPlanModeImpl,
  forceExitPlanMode as forceExitPlanModeImpl,
  logModeArg as logModeArgImpl,
  publishExploreProgress as publishExploreProgressImpl,
  publishToolExecutionUpdate as publishToolExecutionUpdateImpl,
  requestPlanReview as requestPlanReviewImpl,
  resolveNameMatches as resolveNameMatchesImpl,
  resolveTaskReference as resolveTaskReferenceImpl,
  taskCancelFromTool as taskCancelFromToolImpl,
  taskLogsFromTool as taskLogsFromToolImpl,
  tasksInScope as tasksInScopeImpl,
} from "./orchestration-tool-dispatcher-handlers.js";
import type { TodoStateService } from "./todo-state.service.js";
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
  events: StreamLogRegistry;
  tasks: WorkbenchTaskService;
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

type WorkbenchToolExecution = {
  toolName: ToolName;
  toolCall: ToolCallRecord;
  options: ToolRequestOptions;
  identity: ToolCallRecord;
};

export class OrchestrationToolDispatcher {
  private readonly hostTools: HostToolFactory<WorkbenchToolExecution>;

  constructor(readonly deps: OrchestrationToolDispatcherDeps) {
    this.hostTools = createHostToolFactory<WorkbenchToolExecution>({
      execution: {
        context: (request) =>
          this.executionContext(request.toolCall, request.options),
      },
      handlers: {
        forExecution: (request) =>
          this.hostHandlers(request.toolCall, request.options),
      },
      overrides: {
        forExecution: (request) => {
          const localOverride = async (
            args: Record<string, unknown>,
            context: ToolExecutionContext,
          ) =>
            (await this.executeLocalOverride(
              request.toolCall,
              args,
              request.options,
              context,
            )) as ToolExecutionResult;
          return { bash: localOverride, python: localOverride };
        },
      },
    });
  }

  async execute(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<unknown> {
    return this.hostTools.execute(
      {
        toolName: toolCall.toolName as ToolName,
        toolCall,
        options,
        identity: toolCall,
      },
      args,
    );
  }

  hostHandlers(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions = {},
  ): ToolHandlerRegistry {
    const result = (value: Promise<unknown>) =>
      value as Promise<ToolExecutionResult>;
    return {
      ...createInteractionHandlers({
        resolve: async () =>
          this.deps.interactionSessions.resolvedUserQuestion(toolCall.id) as
            | ToolExecutionResult
            | undefined,
        request: (_identity, input) =>
          result(
            this.deps.interactionSessions.requestUserQuestion(
              toolCall,
              input,
              options,
            ),
          ),
      }),
      ...createPlanHandlers({
        enter: (_identity, reason) =>
          result(this.enterPlanMode(toolCall, { reason })),
        present: (_identity, request) =>
          result(
            this.requestPlanReview(
              toolCall,
              {
                file_path: request.filePath,
                title: request.title,
                summary: request.summary,
              },
              options,
            ),
          ),
        forceExit: (_identity, reason) =>
          result(this.forceExitPlanMode(toolCall, { reason })),
      }),
      ...createTaskHandlers({
        start: (args) => result(this.startTasksFromTool(toolCall, args)),
        status: (args) => result(this.taskStatusFromTool(toolCall, args)),
        logs: (args) => result(this.taskLogsFromTool(toolCall, args)),
        cancel: (args) => result(this.taskCancelFromTool(toolCall, args)),
        restart: (args) => result(this.restartTaskFromTool(toolCall, args)),
      }),
      ...createExploreHandlers({
        run: (request, _identity, signal) =>
          result(
            this.deps.runExplore(
              this.deps.getAgent(toolCall.agentId),
              request,
              {
                onProgress: (message) =>
                  this.publishExploreProgress(toolCall, message, options.runId),
                signal,
              },
            ),
          ),
      }),
      ...createTodoHandlers({
        get: async () => this.deps.todoState.get(toolCall.agentId),
        set: async (_identity, todos) => {
          this.deps.todoState.set(toolCall.agentId, todos);
          return this.deps.todoState.get(toolCall.agentId);
        },
      }),
    };
  }

  executionContext(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions = {},
  ): ToolExecutionContext {
    return {
      cwd: toolCall.cwd,
      signal: options.signal,
      dataDir: this.deps.storage.paths.home,
      shellPath: this.deps.storage.settings.runtime.shellPath,
      getApiKey: this.deps.getApiKey,
      getProviderConfig: async (provider) => {
        if (provider === "jira") return this.deps.storage.settings.tools.jira;
        if (provider === "confluence") {
          return this.deps.storage.settings.tools.confluence;
        }
        return undefined;
      },
      onUpdate: (update) =>
        this.publishToolExecutionUpdate(toolCall, update, options.runId),
    };
  }

  async executeLocalOverride(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions,
    executionContext: ToolExecutionContext,
  ): Promise<unknown> {
    delete args.cwd;
    if (toolCall.toolName === "bash" && options.useForegroundBash !== false) {
      const agent = this.deps.getAgent(toolCall.agentId);
      const promoted = await this.deps.tasks.runForegroundBashWithPromotion({
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
        continueAfterPromotion: options.continueAfterPromotedTask !== false,
      });
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
      const definition = toolDefinitionByName("python");
      if (definition?.executionKind !== "local") {
        throw new Error("Python tool executor is unavailable.");
      }
      return definition.executor(args, executionContext);
    }
    throw new Error(`No local override for '${toolCall.toolName}'.`);
  }

  async startTasksFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (args.tasks !== undefined) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "task_start starts exactly one task and does not accept 'tasks'.",
      );
    }
    const command = stringArg(args, "command");
    const agent = this.deps.getAgent(toolCall.agentId);
    const rawCwd = optionalStringArg(args.cwd);
    const cwd = rawCwd
      ? isAbsolute(rawCwd)
        ? rawCwd
        : resolve(agent.projectDir, rawCwd)
      : toolCall.cwd;
    const task = await this.deps.startTask({
      name: optionalStringArg(args.name),
      workerId: agent.workerId,
      projectId: toolCall.projectId,
      conversationId: toolCall.conversationId,
      agentId: toolCall.agentId,
      cwd,
      command,
      env: stringRecordArg(args.env),
      readyUrl: optionalStringArg(args.readyUrl),
      readyOnUrl: Boolean(args.readyOnUrl),
      readyPattern: optionalStringArg(args.readyPattern),
      readyTimeoutMs: optionalBoundedIntegerArg(
        args.readyTimeoutMs,
        "readyTimeoutMs",
        { min: 0, max: 60_000 },
      ),
      timeoutMs: optionalBoundedIntegerArg(args.timeoutMs, "timeoutMs", {
        min: 1,
        max: 86_400_000,
      }),
      notify: typeof args.notify === "boolean" ? args.notify : true,
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
    const bounded = await buildProcessTextResult({
      text: formatTaskStartSummary(task),
      outputFilePrefix: "nerve-task-start",
      exitMessagePrefix: "Task start",
      dataDir: this.deps.storage.paths.home,
    });
    return taskStartToolResultSchema.parse({
      task,
      contentBlocks: bounded.contentBlocks,
    });
  }

  async taskStatusFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const taskId = optionalStringArg(args.taskId);
    const taskIds = Array.isArray(args.taskIds)
      ? args.taskIds.map((value) => {
          if (typeof value !== "string" || !value.trim()) {
            throw new CodedToolError(
              "TASK_ARGUMENT_INVALID",
              "Every taskIds entry must be a non-empty string.",
            );
          }
          return value.trim();
        })
      : undefined;
    const groupId = optionalStringArg(args.groupId);
    const selectorCount = [taskId, taskIds, groupId].filter(Boolean).length;
    if (selectorCount > 1 || (taskIds && taskIds.length === 0)) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "Provide at most one non-empty selector: taskId, taskIds, or groupId.",
      );
    }
    if (taskIds && taskIds.length > 20) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "task_status supports at most 20 task IDs.",
      );
    }
    const limit =
      optionalBoundedIntegerArg(args.limit, "limit", { min: 1, max: 50 }) ?? 20;
    const status = optionalStringArg(args.status) as
      | TaskStatus
      | "active"
      | "all"
      | undefined;
    let tasks = taskId
      ? [this.resolveTaskReference(taskId, toolCall)]
      : taskIds
        ? taskIds.map((ref) => this.resolveTaskReference(ref, toolCall))
        : groupId
          ? this.tasksInScope(toolCall).filter(
              (task) => task.groupId === groupId,
            )
          : this.tasksInScope(toolCall);

    if (status === "active" || (!status && selectorCount === 0)) {
      tasks = tasks.filter((task) => isActiveTaskStatus(task.status));
    } else if (status && status !== "all") {
      tasks = tasks.filter((task) => task.status === status);
    }
    tasks = tasks.slice(0, limit);
    const bounded = await buildProcessTextResult({
      text: formatTaskStatusSummary(tasks),
      outputFilePrefix: "nerve-task-status",
      exitMessagePrefix: "Task status",
      dataDir: this.deps.storage.paths.home,
    });
    return taskStatusToolResultSchema.parse({
      tasks,
      contentBlocks: bounded.contentBlocks,
    });
  }
  async restartTaskFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const restartedFromTaskId = this.resolveTaskReference(
      stringArg(args, "taskId"),
      toolCall,
    ).id;
    const task =
      await this.restartTaskWithStructuredErrors(restartedFromTaskId);
    const label = task.name ? `${task.name} (${task.id})` : task.id;
    return taskRestartToolResultSchema.parse({
      task,
      restartedFromTaskId,
      newTaskId: task.id,
      restartRootTaskId: task.restartRootTaskId ?? restartedFromTaskId,
      contentBlocks: [
        {
          type: "text",
          text: `Restarted ${restartedFromTaskId} as ${label}. Use task_status/task_logs with taskId "${task.id}".`,
        },
      ],
    });
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
  resolveTaskReference(ref: string, toolCall: ToolCallRecord): TaskRecord {
    return resolveTaskReferenceImpl.call(this, ref, toolCall);
  }
  resolveNameMatches(
    _ref: string,
    matches: TaskRecord[],
  ): TaskRecord | undefined {
    return resolveNameMatchesImpl.call(this, _ref, matches);
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
