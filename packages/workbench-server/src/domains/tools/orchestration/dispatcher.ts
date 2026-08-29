import { isAbsolute, resolve } from "node:path";
import {
  buildProcessTextResult,
  createExploreHandlers,
  createInteractionHandlers,
  createPlanHandlers,
  resolveCommandCwd,
  createTaskHandlers,
  createTodoHandlers,
  type ExplainImageRequest,
  type ExplainImageResponse,
  type ToolExecutionContext,
  type ToolExecutionOutputUpdate,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
  toolDefinitionByName,
} from "@nervekit/tools";
import { type AgentRecord } from "@nervekit/contracts/agents";
import { type Mode } from "@nervekit/contracts/settings";
import {
  taskControlToolResultSchema,
  taskStartToolResultSchema,
  taskStatusToolResultSchema,
  type ToolCallRecord,
  type ToolName,
} from "@nervekit/contracts/tools";
import { type TaskRecord, type TaskStatus } from "@nervekit/contracts/tasks";
import type { ConversationRuntime } from "../../runs/runtime/conversation-runtime.js";
import {
  createHostToolFactory,
  type HostToolFactory,
} from "./host-tool-factory.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import { join } from "node:path";
import {
  storagePaths,
  type InitializedStorage,
} from "../../../infrastructure/storage-bootstrap/index.js";
import type { PlanService } from "../../plans/plan-service.js";
import type { PythonRuntimeService } from "../execution/python-runtime.js";
import {
  isActiveTaskStatus,
  isPathInDirectoryTree,
} from "../../tasks/index.js";
import type { WorkbenchTaskService } from "../../tasks/adapters/workbench-task-service.js";
import {
  formatTaskCancelSummary,
  formatTaskStartSummary,
  formatTaskStatusSummary,
} from "../../tasks/model/task-summary-format.js";
import type { InteractionSessionService } from "./interaction-session.service.js";
import {
  integrationCredentialProvider,
  integrationProviderConfig,
} from "../execution/integration-profile-resolution.js";
import { LiveToolOutputPublisher } from "../execution/live-tool-output-publisher.js";
import {
  enterPlanMode as enterPlanModeImpl,
  forceExitPlanMode as forceExitPlanModeImpl,
  logModeArg as logModeArgImpl,
  publishExploreProgress as publishExploreProgressImpl,
  publishToolExecutionUpdate as publishToolExecutionUpdateImpl,
  requestPlanReview as requestPlanReviewImpl,
  classifyCancelResult,
  resolveNameMatches as resolveNameMatchesImpl,
  resolveTaskReference as resolveTaskReferenceImpl,
  taskLogsFromTool as taskLogsFromToolImpl,
  tasksInScope as tasksInScopeImpl,
} from "./dispatcher-handlers.js";
import type { TodoStateService } from "./todo-state.service.js";
import {
  optionalBoundedIntegerArg,
  optionalStringArg,
  stringArg,
  stringRecordArg,
} from "../execution/tool-arguments.js";
import { CodedToolError } from "../execution/tool-errors.js";
import type {
  ExploreProgressUpdate,
  ExploreRunner,
  TaskStarter,
  ToolRequestOptions,
} from "../execution/tool-service.js";

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
  explainImage(request: ExplainImageRequest): Promise<ExplainImageResponse>;
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

function taskReadinessArgs(value: unknown): {
  readyUrl?: string;
  readyOnUrl?: boolean;
  readyPattern?: string;
  readyTimeoutMs?: number;
} {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CodedToolError(
      "TASK_ARGUMENT_INVALID",
      "task_start ready must be an object.",
    );
  }
  const ready = value as Record<string, unknown>;
  const timeout = optionalBoundedIntegerArg(
    ready.timeoutMs,
    "ready.timeoutMs",
    {
      min: 0,
      max: 60_000,
    },
  );
  if (ready.kind === "url") {
    return {
      readyUrl: stringArg(ready, "url"),
      ...(timeout === undefined ? {} : { readyTimeoutMs: timeout }),
    };
  }
  if (ready.kind === "detected_url") {
    return {
      readyOnUrl: true,
      ...(timeout === undefined ? {} : { readyTimeoutMs: timeout }),
    };
  }
  if (ready.kind === "pattern") {
    return {
      readyPattern: stringArg(ready, "pattern"),
      ...(timeout === undefined ? {} : { readyTimeoutMs: timeout }),
    };
  }
  throw new CodedToolError(
    "TASK_ARGUMENT_INVALID",
    "task_start ready.kind must be url, detected_url, or pattern.",
  );
}

export class OrchestrationToolDispatcher {
  private readonly hostTools: HostToolFactory<WorkbenchToolExecution>;
  readonly liveOutput: LiveToolOutputPublisher;

  constructor(readonly deps: OrchestrationToolDispatcherDeps) {
    this.liveOutput = new LiveToolOutputPublisher(
      deps.events,
      deps.conversationRuntime,
    );
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
          return {
            bash: localOverride,
            python_exec: localOverride,
          } satisfies ToolHandlerRegistry;
        },
      },
    });
  }

  async execute(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<unknown> {
    try {
      return await this.hostTools.execute(
        {
          toolName: toolCall.toolName as ToolName,
          toolCall,
          options,
          identity: toolCall,
        },
        args,
      );
    } finally {
      await this.liveOutput.drain(toolCall.id);
    }
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
              { file_path: request.filePath },
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
        control: (args) => result(this.controlTaskFromTool(toolCall, args)),
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
                parentRunId: toolCall.runId,
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
      artifactDir: join(
        this.deps.storage.paths.payloadsPath ??
          storagePaths(this.deps.storage.paths.home).payloadsPath,
        "conversations",
        toolCall.conversationId,
        "tool-calls",
        toolCall.id,
        "files",
      ),
      shellPath: this.deps.storage.settings.runtime.shellPath,
      getApiKey: async (provider) => {
        const credentialProvider = integrationCredentialProvider(
          this.deps.storage.settings,
          provider,
        );
        return credentialProvider
          ? this.deps.getApiKey(credentialProvider)
          : undefined;
      },
      explainImage: this.deps.explainImage,
      getProviderConfig: async (provider) =>
        integrationProviderConfig(this.deps.storage.settings, provider),
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
    if (toolCall.toolName === "bash") {
      const cwd = await resolveCommandCwd(toolCall.cwd, args.cwd);
      delete args.cwd;
      if (options.useForegroundBash !== false) {
        const autoPromotion =
          this.deps.storage.settings.tools.bash.autoPromotion;
        const promoted = await this.deps.tasks.runForegroundBashWithPromotion({
          command: stringArg(args, "command"),
          cwd,
          projectId: toolCall.projectId,
          conversationId: toolCall.conversationId,
          agentId: toolCall.agentId,
          timeoutMs: bashTimeoutMs(args.timeout),
          autoPromoteAfterMs: autoPromotion.enabled
            ? autoPromotion.afterMs
            : undefined,
          signal: options.signal,
          artifactDir: executionContext.artifactDir,
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
      const definition = toolDefinitionByName("bash");
      if (definition?.executionKind !== "local") {
        throw new Error("Bash tool executor is unavailable.");
      }
      return definition.executor(args, { ...executionContext, cwd });
    }
    if (toolCall.toolName === "python_exec") {
      const cwd = await resolveCommandCwd(toolCall.cwd, args.cwd);
      delete args.cwd;
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
      const definition = toolDefinitionByName("python_exec");
      if (definition?.executionKind !== "local") {
        throw new Error("Python tool executor is unavailable.");
      }
      return definition.executor(args, { ...executionContext, cwd });
    }
    throw new Error(`No local override for '${toolCall.toolName}'.`);
  }

  async startTasksFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const command = stringArg(args, "command");
    const agent = this.deps.getAgent(toolCall.agentId);
    const rawCwd = optionalStringArg(args.cwd);
    if (rawCwd && isAbsolute(rawCwd)) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "task_start cwd must be relative to the project.",
      );
    }
    const cwd = rawCwd ? resolve(agent.projectDir, rawCwd) : toolCall.cwd;
    if (!isPathInDirectoryTree(agent.projectDir, cwd)) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "task_start cwd must remain inside the project.",
      );
    }
    const ready = taskReadinessArgs(args.ready);
    const task = await this.deps.startTask({
      name: optionalStringArg(args.name),
      projectId: toolCall.projectId,
      conversationId: toolCall.conversationId,
      agentId: toolCall.agentId,
      cwd,
      command,
      env: stringRecordArg(args.env),
      readyUrl: ready.readyUrl,
      readyOnUrl: ready.readyOnUrl,
      readyPattern: ready.readyPattern,
      readyTimeoutMs: ready.readyTimeoutMs,
      timeoutMs: optionalBoundedIntegerArg(args.timeoutMs, "timeoutMs", {
        min: 1,
        max: 86_400_000,
      }),
      notify: true,
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
    const activePeers = this.tasksInScope(toolCall).filter(
      (candidate) =>
        candidate.id !== task.id && isActiveTaskStatus(candidate.status),
    );
    const otherActiveTaskCount = activePeers.length;
    const otherActiveTasks = activePeers.slice(0, 20);
    const bounded = await buildProcessTextResult({
      text: formatTaskStartSummary({
        task,
        otherActiveTasks,
        otherActiveTaskCount,
      }),
      outputFilePrefix: "nerve-task-start",
      exitMessagePrefix: "Task start",
      dataDir: this.deps.storage.paths.home,
    });
    return taskStartToolResultSchema.parse({
      task,
      otherActiveTasks,
      otherActiveTaskCount,
      contentBlocks: bounded.contentBlocks,
    });
  }

  async taskStatusFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const taskRefs = Array.isArray(args.tasks)
      ? args.tasks.map((value) => {
          if (typeof value !== "string" || !value.trim()) {
            throw new CodedToolError(
              "TASK_ARGUMENT_INVALID",
              "Every tasks entry must be a non-empty string.",
            );
          }
          return value.trim();
        })
      : undefined;
    if (taskRefs && (taskRefs.length === 0 || taskRefs.length > 20)) {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "task_status tasks must contain between 1 and 20 entries.",
      );
    }
    const limit =
      optionalBoundedIntegerArg(args.limit, "limit", { min: 1, max: 50 }) ?? 20;
    const status = optionalStringArg(args.status) as
      | TaskStatus
      | "active"
      | "all"
      | undefined;
    let tasks = taskRefs
      ? taskRefs.map((ref) => this.resolveTaskReference(ref, toolCall))
      : this.tasksInScope(toolCall);

    if (status === "active" || (!status && !taskRefs)) {
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
  async controlTaskFromTool(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const action = stringArg(args, "action");
    const before = this.resolveTaskReference(stringArg(args, "task"), toolCall);

    if (action === "restart") {
      const restartedFromTaskId = before.id;
      const task =
        await this.restartTaskWithStructuredErrors(restartedFromTaskId);
      const label = task.name ? `${task.name} (${task.id})` : task.id;
      return taskControlToolResultSchema.parse({
        action,
        task,
        restartedFromTaskId,
        newTaskId: task.id,
        restartRootTaskId: task.restartRootTaskId ?? restartedFromTaskId,
        contentBlocks: [
          {
            type: "text",
            text: `Restarted ${restartedFromTaskId} as ${label}. Use task_status with tasks ["${task.id}"] or task_logs with task "${task.id}".`,
          },
        ],
      });
    }

    if (action !== "stop") {
      throw new CodedToolError(
        "TASK_ARGUMENT_INVALID",
        "task_control action must be stop or restart.",
      );
    }
    const request = {};
    const requestedSignal = "SIGTERM";
    const task = await this.deps.tasks.cancelTask(before.id, request);
    const result = classifyCancelResult(before, task, requestedSignal);
    const bounded = await buildProcessTextResult({
      text: formatTaskCancelSummary([result]),
      outputFilePrefix: "nerve-task-stop",
      exitMessagePrefix: "Task stop",
      dataDir: this.deps.storage.paths.home,
    });
    return taskControlToolResultSchema.parse({
      action,
      task,
      result,
      contentBlocks: bounded.contentBlocks,
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
  ): Promise<void> {
    return publishToolExecutionUpdateImpl.call(this, toolCall, update, runId);
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
