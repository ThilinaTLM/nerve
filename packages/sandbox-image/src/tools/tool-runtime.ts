import path from "node:path";
import type { SandboxConfigV1, ToolName } from "@nervekit/shared";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "@nervekit/tools";
import { executeTool } from "@nervekit/tools";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import { Redactor } from "../security/redaction.js";
import { JsonlStore } from "../state/jsonl-store.js";
import type { ApprovalWaiter } from "./approval-waiter.js";
import type { InputWaiter } from "./input-waiter.js";
import type { TaskSupervisor } from "./task-supervisor.js";
import { TodoStore } from "./todo-store.js";
import { computeToolGroupStatus } from "./tool-groups.js";
import {
  decideShellCommand,
  enforceToolPolicy,
  type ToolDecision,
} from "./tool-policy.js";

export type SandboxToolRuntimeOptions = {
  workspaceDir: string;
  stateDir: string;
  dataDir?: string;
  readOnly?: boolean;
  redactor?: Redactor;
  approvalWaiter?: ApprovalWaiter;
  inputWaiter?: InputWaiter;
  taskSupervisor?: TaskSupervisor;
  todoStore?: TodoStore;
  exploreRuntime?: ExploreRuntime;
};

const toolToGroup: Record<string, string> = {
  read: "fileInspection",
  grep: "fileInspection",
  find: "fileInspection",
  ls: "fileInspection",
  edit: "fileEditing",
  write: "fileEditing",
  bash: "shell",
  python: "python",
  web_search: "web",
  web_fetch: "web",
  ask_user: "input",
  todos_set: "todos",
  todos_get: "todos",
  task_start: "taskManagement",
  task_status: "taskManagement",
  task_logs: "taskManagement",
  task_cancel: "taskManagement",
  task_restart: "taskManagement",
  task_list: "taskManagement",
  explore: "explore",
  plan_mode_enter: "planMode",
};

export class SandboxToolRuntime {
  private readonly records: JsonlStore<Record<string, unknown>>;
  private readonly redactor: Redactor;
  private readonly todoStore: TodoStore;
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly options: SandboxToolRuntimeOptions = {
      workspaceDir: "/workspace",
      stateDir: "/state",
    },
  ) {
    this.records = new JsonlStore(
      path.join(options.stateDir, "tools", "tool-calls.jsonl"),
    );
    this.redactor = options.redactor ?? new Redactor({ secrets: [] });
    this.todoStore = options.todoStore ?? new TodoStore(options.stateDir);
  }

  groups() {
    return computeToolGroupStatus(this.config, {
      readOnly: this.options.readOnly,
    });
  }

  decide(tool: string, args: unknown): ToolDecision {
    if (tool === "bash") {
      const shell = this.config.tools?.groups?.shell;
      return decideShellCommand(
        String((args as { command?: unknown })?.command ?? ""),
        shell?.requireApproval ?? "risky",
      );
    }
    const group = toolToGroup[tool];
    const active = this.groups().find((entry) => entry.group === group);
    if (!active?.active || !active.tools.includes(tool)) {
      return {
        allowed: false,
        reason: `tool disabled by sandbox policy: ${tool}`,
      };
    }
    return { allowed: true };
  }

  async execute(
    tool: string,
    args: Record<string, unknown>,
    context: Partial<ToolExecutionContext> = {},
  ): Promise<ToolExecutionResult> {
    const toolCallId = `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await this.record({
      toolCallId,
      toolName: tool,
      status: "requested",
      args,
    });
    if (isPlanModeTool(tool)) {
      await this.record({
        toolCallId,
        toolName: tool,
        status: "failed",
        error: "plan mode is unavailable in sandbox runtime v1",
      });
      throw new Error(
        "UNAVAILABLE: plan mode is unavailable in sandbox runtime v1",
      );
    }
    const decision = this.decide(tool, args);
    if (!decision.allowed && !decision.approvalRequired) {
      await this.record({
        toolCallId,
        toolName: tool,
        status: "failed",
        error: decision.reason,
      });
      throw new Error(decision.reason ?? "tool denied by sandbox policy");
    }
    if (decision.approvalRequired && this.options.approvalWaiter) {
      await this.options.approvalWaiter.request({
        id: toolCallId,
        toolCallId,
        conversationId: scopeValue(context, "conversationId") ?? "conv_unknown",
        agentId: scopeValue(context, "agentId") ?? "agent_main",
        runId: scopeValue(context, "runId") ?? "run_unknown",
        reason: decision.reason ?? "approval required",
        risk: [decision.reason ?? "policy"],
        normalizedArgs: args,
        displayArgs: this.redactor.redact(args),
      });
      await this.record({
        toolCallId,
        toolName: tool,
        status: "waiting_for_approval",
        approvalId: toolCallId,
      });
      throw new Error(`WAITING_FOR_APPROVAL: ${toolCallId}`);
    }
    if (isOrchestrationTool(tool)) {
      const result = await this.executeOrchestrationTool(
        tool,
        args,
        context,
        toolCallId,
      );
      await this.record({
        toolCallId,
        toolName: tool,
        status: "completed",
        result,
      });
      return result;
    }
    await enforceToolPolicy(tool, args, this.config, this.options);
    await this.record({ toolCallId, toolName: tool, status: "started" });
    try {
      const result = await executeTool(
        tool as ToolName,
        this.redactor.redact(args) as Record<string, unknown>,
        {
          cwd: this.options.workspaceDir,
          dataDir:
            this.options.dataDir ??
            path.join(this.options.stateDir, "tool-data"),
          ...context,
        },
      );
      await this.record({
        toolCallId,
        toolName: tool,
        status: "completed",
        result,
      });
      return this.redactor.redact(result) as ToolExecutionResult;
    } catch (error) {
      await this.record({
        toolCallId,
        toolName: tool,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async executeOrchestrationTool(
    tool: string,
    args: Record<string, unknown>,
    context: Partial<ToolExecutionContext>,
    toolCallId: string,
  ): Promise<ToolExecutionResult> {
    const scope = {
      conversationId: scopeValue(context, "conversationId") ?? "conv_unknown",
      agentId: scopeValue(context, "agentId") ?? "agent_main",
      runId: scopeValue(context, "runId") ?? "run_unknown",
    };
    if (tool === "ask_user") {
      if (!this.options.inputWaiter)
        throw new Error("UNAVAILABLE: input waiter is not configured");
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
      throw new Error(`WAITING_FOR_INPUT: ${wait.requestId}`);
    }
    if (tool === "todos_set") {
      const todos = Array.isArray(args.todos)
        ? args.todos.map((todo) => ({
            todo: String((todo as { todo?: unknown }).todo ?? ""),
            done: Boolean((todo as { done?: unknown }).done),
          }))
        : [];
      const saved = await this.todoStore.set(scope, todos);
      return { content: JSON.stringify(saved), details: { todos: saved } };
    }
    if (tool === "todos_get") {
      const todos = await this.todoStore.get(scope);
      return { content: JSON.stringify(todos), details: { todos } };
    }
    if (tool.startsWith("task_")) {
      if (!this.options.taskSupervisor)
        throw new Error("UNAVAILABLE: task supervisor is not configured");
      return this.executeTaskTool(tool, args);
    }
    if (tool === "explore") {
      if (!this.options.exploreRuntime)
        throw new Error("UNAVAILABLE: explore runtime is not configured");
      const result = await this.options.exploreRuntime.execute({
        ...scope,
        task: String(args.task ?? ""),
        context: typeof args.context === "string" ? args.context : undefined,
        label: typeof args.label === "string" ? args.label : undefined,
      });
      return result;
    }
    throw new Error(`${tool} is mediated by sandbox orchestration state`);
  }

  private executeTaskTool(
    tool: string,
    args: Record<string, unknown>,
  ): ToolExecutionResult {
    const supervisor = this.options.taskSupervisor;
    if (!supervisor)
      throw new Error("UNAVAILABLE: task supervisor is not configured");
    if (tool === "task_start") {
      const task = supervisor.start(
        String(args.command ?? ""),
        typeof args.cwd === "string" ? args.cwd : this.options.workspaceDir,
        typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        { name: typeof args.name === "string" ? args.name : undefined },
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

  private async record(entry: Record<string, unknown>): Promise<void> {
    await this.records.append(
      this.redactor.redact({
        ...entry,
        ts: new Date().toISOString(),
      }) as Record<string, unknown>,
    );
  }
}

function isPlanModeTool(tool: string): boolean {
  return [
    "plan_mode_enter",
    "plan_mode_present",
    "plan_mode_force_exit",
  ].includes(tool);
}

function scopeValue(
  context: Partial<ToolExecutionContext>,
  key: "conversationId" | "agentId" | "runId",
): string | undefined {
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isOrchestrationTool(tool: string): boolean {
  return [
    "ask_user",
    "todos_set",
    "todos_get",
    "task_start",
    "task_status",
    "task_logs",
    "task_cancel",
    "task_restart",
    "task_list",
    "explore",
    "plan_mode_enter",
    "plan_mode_present",
    "plan_mode_force_exit",
  ].includes(tool);
}
