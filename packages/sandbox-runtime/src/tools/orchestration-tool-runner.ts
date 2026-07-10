import { AgentToolSuspension } from "@nervekit/agent-runtime";
import {
  createTodoHandlers,
  type ToolExecutionContext,
  type ToolExecutionResult,
  type ToolHandlerRegistry,
} from "@nervekit/agent-tools";
import type { PlanReviewRecord } from "@nervekit/contracts";
import type { AgentConfigStore } from "../agent/agent-config-store.js";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import { Redactor } from "../security/redaction.js";
import type { InputWaiter } from "./input-waiter.js";
import type { PlanReviewWaiter } from "./plan-review-waiter.js";
import type { TaskSupervisor } from "./task-supervisor.js";
import type { TodoStore } from "./todo-store.js";
import { type ToolRuntimeScope, toolScope } from "./tool-scope.js";

export type OrchestrationToolRunnerOptions = {
  workspaceDir: string;
  redactor?: Redactor;
  inputWaiter?: InputWaiter;
  planReviewWaiter?: PlanReviewWaiter;
  configStore?: AgentConfigStore;
  taskSupervisor?: TaskSupervisor;
  todoStore: TodoStore;
  exploreRuntime?: ExploreRuntime;
  record: (
    entry: Record<string, unknown>,
    context?: Partial<ToolExecutionContext> & {
      conversationId?: string;
      agentId?: string;
      runId?: string;
    },
  ) => Promise<void>;
};

export type ExecuteOrchestrationOptions = {
  toolCallId: string;
  setCancel?: (cancel: () => Promise<void> | void) => void;
};

export class OrchestrationToolRunner {
  private readonly redactor: Redactor;
  private readonly todoHandlers: ToolHandlerRegistry;

  constructor(private readonly options: OrchestrationToolRunnerOptions) {
    this.redactor = options.redactor ?? new Redactor({ secrets: [] });
    this.todoHandlers = createTodoHandlers({
      get: (identity) =>
        this.options.todoStore.get(identity as ToolRuntimeScope),
      set: (identity, todos) =>
        this.options.todoStore.set(identity as ToolRuntimeScope, todos),
    });
  }

  async execute(
    tool: string,
    args: Record<string, unknown>,
    context: Partial<ToolExecutionContext>,
    execution: ExecuteOrchestrationOptions,
  ): Promise<ToolExecutionResult> {
    const scope = toolScope(context);
    if (tool === "ask_user")
      return this.executeAskUser(
        tool,
        args,
        context,
        execution.toolCallId,
        scope,
      );
    if (tool === "plan_mode_enter") return this.enterPlanMode(args);
    if (tool === "plan_mode_present")
      return this.presentPlan(args, context, execution.toolCallId, scope);
    if (tool === "plan_mode_force_exit") return this.forceExitPlanMode(args);
    if (tool === "todos_set" || tool === "todos_get") {
      const handler = this.todoHandlers[tool];
      if (!handler) throw new Error(`Missing shared handler for ${tool}.`);
      return handler(args, {
        cwd: this.options.workspaceDir,
        ...context,
        toolName: tool,
        identity: scope,
      });
    }
    if (tool.startsWith("task_"))
      return this.executeTaskTool(tool, args, scope, execution.toolCallId);
    if (tool === "explore")
      return this.executeExplore(tool, args, context, scope, execution);
    throw new Error(`${tool} is mediated by sandbox orchestration state`);
  }

  private async executeAskUser(
    tool: string,
    args: Record<string, unknown>,
    context: Partial<ToolExecutionContext>,
    toolCallId: string,
    scope: ToolRuntimeScope,
  ): Promise<ToolExecutionResult> {
    if (!this.options.inputWaiter)
      throw new Error("UNAVAILABLE: input waiter is not configured");
    const submitted = this.options.inputWaiter.resolutionForRequest(toolCallId);
    if (submitted?.response?.text !== undefined) {
      return {
        content: this.redactor.redactText(submitted.response.text),
        details: { requestId: toolCallId, status: "submitted" },
      };
    }
    const wait = await this.options.inputWaiter.request({
      requestId: toolCallId,
      ...scope,
      question: { text: String(args.question ?? "") },
      context: typeof args.context === "string" ? args.context : undefined,
      recommendation:
        typeof args.recommendation === "string"
          ? args.recommendation
          : undefined,
      placeholder:
        typeof args.placeholder === "string" ? args.placeholder : undefined,
      redactedDisplay: {
        text: this.redactor.redactText(String(args.question ?? "")),
      },
    });
    await this.options.record(
      {
        toolCallId,
        toolName: tool,
        status: "waiting_for_input",
        lifecycleSeq: 2,
      },
      context,
    );
    throw new AgentToolSuspension({
      toolCallId,
      toolName: tool,
      reason: `WAITING_FOR_INPUT: ${wait.requestId}`,
    });
  }

  private async enterPlanMode(
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    if (!this.options.planReviewWaiter || !this.options.configStore)
      throw new Error("UNAVAILABLE: plan mode is not configured");
    const planDir = await this.options.planReviewWaiter.ensurePlanDir();
    const alreadyPlanning = this.options.configStore.read().mode === "planning";
    await this.options.configStore.update({ mode: "planning" });
    const reason =
      typeof args.reason === "string"
        ? args.reason
        : "Agent entered planning mode.";
    return {
      content: `Plan mode active. Write plans under ${planDir}, then call plan_mode_present with the plan file path.`,
      details: { mode: "planning", planDir, alreadyPlanning, reason },
    };
  }

  private async presentPlan(
    args: Record<string, unknown>,
    context: Partial<ToolExecutionContext>,
    toolCallId: string,
    scope: ToolRuntimeScope,
  ): Promise<ToolExecutionResult> {
    const waiter = this.options.planReviewWaiter;
    if (!waiter)
      throw new Error("UNAVAILABLE: plan review waiter is not configured");
    const existing = waiter.byProviderToolCallId(toolCallId);
    if (existing && existing.status !== "pending")
      return planReviewResult(existing.review);
    if (existing)
      throw new AgentToolSuspension({
        toolCallId,
        toolName: "plan_mode_present",
        reason: `WAITING_FOR_PLAN_REVIEW: ${existing.review.id}`,
      });
    const review = await waiter.request({
      providerToolCallId: toolCallId,
      ...scope,
      cwd: this.options.workspaceDir,
      filePath: String(args.file_path ?? ""),
      title: typeof args.title === "string" ? args.title : undefined,
      summary: typeof args.summary === "string" ? args.summary : undefined,
    });
    await this.options.record(
      {
        toolCallId,
        toolName: "plan_mode_present",
        status: "waiting_for_input",
        lifecycleSeq: 2,
        result: planReviewPayload(review.review),
      },
      context,
    );
    throw new AgentToolSuspension({
      toolCallId,
      toolName: "plan_mode_present",
      reason: `WAITING_FOR_PLAN_REVIEW: ${review.review.id}`,
    });
  }

  private async forceExitPlanMode(
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    if (!this.options.configStore)
      throw new Error("UNAVAILABLE: plan mode is not configured");
    await this.options.configStore.update({ mode: "coding" });
    const reason =
      typeof args.reason === "string"
        ? args.reason
        : "Agent exited planning mode.";
    return {
      content: `Plan mode exited: ${reason}`,
      details: { mode: "coding", reason },
    };
  }

  private executeTaskTool(
    tool: string,
    args: Record<string, unknown>,
    scope: ToolRuntimeScope,
    toolCallId: string,
  ): ToolExecutionResult {
    const supervisor = this.options.taskSupervisor;
    if (!supervisor)
      throw new Error("UNAVAILABLE: task supervisor is not configured");
    if (tool === "task_start") {
      const task = supervisor.start(
        String(args.command ?? ""),
        typeof args.cwd === "string" ? args.cwd : this.options.workspaceDir,
        typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        {
          name: typeof args.name === "string" ? args.name : undefined,
          ...scope,
          toolCallId,
        },
      );
      return { content: `Started ${task.id}`, details: { task } };
    }
    if (tool === "task_status") {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      const tasks = taskId
        ? [supervisor.get(taskId)].filter(Boolean)
        : supervisor.list();
      return { content: JSON.stringify(tasks), details: { tasks } };
    }
    if (tool === "task_logs") {
      const taskId = String(args.taskId ?? "");
      const logs = supervisor.logs(
        taskId,
        typeof args.cursor === "number" ? args.cursor : 0,
        typeof args.limit === "number" ? args.limit : undefined,
      );
      if (!logs) throw new Error(`Unknown task: ${taskId}`);
      return { content: logs.content, details: logs };
    }
    if (tool === "task_cancel") {
      const taskId = String(args.taskId ?? "");
      const task = supervisor.cancel(taskId);
      if (!task) throw new Error(`Unknown task: ${taskId}`);
      return { content: `Cancelled ${task.id}`, details: { task } };
    }
    if (tool === "task_restart") {
      const taskId = String(args.taskId ?? "");
      const task = supervisor.restart(taskId);
      if (!task) throw new Error(`Unknown task: ${taskId}`);
      return { content: `Restarted ${task.id}`, details: { task } };
    }
    if (tool === "task_list") {
      const tasks = supervisor.list();
      return { content: JSON.stringify(tasks), details: { tasks } };
    }
    throw new Error(`Unsupported task tool: ${tool}`);
  }

  private async executeExplore(
    _tool: string,
    args: Record<string, unknown>,
    context: Partial<ToolExecutionContext>,
    scope: ToolRuntimeScope,
    execution: ExecuteOrchestrationOptions,
  ): Promise<ToolExecutionResult> {
    const exploreRuntime = this.options.exploreRuntime;
    if (!exploreRuntime)
      throw new Error("UNAVAILABLE: explore runtime is not configured");
    execution.setCancel?.(() => exploreRuntime.cancelRun(scope));
    const signal = (context as { signal?: AbortSignal }).signal;
    if (Array.isArray(args.tasks)) {
      const results = [];
      for (const taskInput of args.tasks) {
        const task = taskInput as { task?: unknown; label?: unknown };
        results.push(
          await exploreRuntime.execute({
            ...scope,
            task: String(task.task ?? ""),
            context:
              typeof args.context === "string" ? args.context : undefined,
            label: typeof task.label === "string" ? task.label : undefined,
            depth: typeof args.depth === "number" ? args.depth : undefined,
            signal,
          }),
        );
      }
      return {
        content: results.map((result) => result.content).join("\n\n---\n\n"),
        details: { children: results.map((result) => result.details) },
      };
    }
    return exploreRuntime.execute({
      ...scope,
      task: String(args.task ?? ""),
      context: typeof args.context === "string" ? args.context : undefined,
      label: typeof args.label === "string" ? args.label : undefined,
      depth: typeof args.depth === "number" ? args.depth : undefined,
      signal,
    });
  }
}

function planReviewPayload(review: PlanReviewRecord): Record<string, unknown> {
  return {
    review,
    outcome: review.status,
    feedback: review.feedback,
  };
}

function planReviewResult(review: PlanReviewRecord): ToolExecutionResult {
  const outcome = review.status;
  const text =
    outcome === "accepted"
      ? "Plan accepted. Exit planning mode and implement the accepted plan."
      : outcome === "changes_requested"
        ? "Plan changes requested. Revise the plan using the feedback and present it again."
        : outcome === "discarded"
          ? "Plan discarded."
          : "Plan is awaiting user review.";
  return {
    content: text,
    details: planReviewPayload(review),
  };
}
