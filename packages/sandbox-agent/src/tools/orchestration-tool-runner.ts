import { AgentToolSuspension } from "@nervekit/agent";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "@nervekit/tools";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import { Redactor } from "../security/redaction.js";
import type { InputWaiter } from "./input-waiter.js";
import type { TaskSupervisor } from "./task-supervisor.js";
import type { TodoStore } from "./todo-store.js";
import { type ToolRuntimeScope, toolScope } from "./tool-scope.js";

export type OrchestrationToolRunnerOptions = {
  workspaceDir: string;
  redactor?: Redactor;
  inputWaiter?: InputWaiter;
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

  constructor(private readonly options: OrchestrationToolRunnerOptions) {
    this.redactor = options.redactor ?? new Redactor({ secrets: [] });
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
    if (tool === "todos_set") return this.executeTodosSet(args, scope);
    if (tool === "todos_get") return this.executeTodosGet(scope);
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

  private async executeTodosSet(
    args: Record<string, unknown>,
    scope: ToolRuntimeScope,
  ): Promise<ToolExecutionResult> {
    const todos = Array.isArray(args.todos)
      ? args.todos.map((todo) => ({
          todo: String((todo as { todo?: unknown }).todo ?? ""),
          done: Boolean((todo as { done?: unknown }).done),
        }))
      : [];
    const saved = await this.options.todoStore.set(scope, todos);
    return { content: JSON.stringify(saved), details: { todos: saved } };
  }

  private async executeTodosGet(
    scope: ToolRuntimeScope,
  ): Promise<ToolExecutionResult> {
    const todos = await this.options.todoStore.get(scope);
    return { content: JSON.stringify(todos), details: { todos } };
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
