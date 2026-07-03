import path from "node:path";
import { AgentToolSuspension } from "@nervekit/agent";
import type { SandboxConfigV1, ToolName } from "@nervekit/shared";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "@nervekit/tools";
import { executeTool } from "@nervekit/tools";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import type { ToolCallStore } from "../agent/tool-call-store.js";
import { Redactor } from "../security/redaction.js";
import { sandboxSha256Digest } from "../state/hash.js";
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
  toolCallStore?: ToolCallStore;
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
    context: Partial<ToolExecutionContext> & {
      conversationId?: string;
      agentId?: string;
      runId?: string;
      executionId?: string;
      toolCallId?: string;
    } = {},
  ): Promise<ToolExecutionResult> {
    const toolCallId =
      context.toolCallId ??
      `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await this.record(
      {
        toolCallId,
        toolName: tool,
        status: "requested",
        displayArgs: this.redactor.redact(args),
        lifecycleSeq: 1,
      },
      context,
    );
    if (isPlanModeTool(tool)) {
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "failed",
          error: "plan mode is unavailable in sandbox runtime v1",
        },
        context,
      );
      throw new Error(
        "UNAVAILABLE: plan mode is unavailable in sandbox runtime v1",
      );
    }
    const decision = this.decide(tool, args);
    if (!decision.allowed && !decision.approvalRequired) {
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "failed",
          error: decision.reason,
        },
        context,
      );
      throw new Error(decision.reason ?? "tool denied by sandbox policy");
    }
    if (decision.approvalRequired && this.options.approvalWaiter) {
      const scope = toolScope(context);
      const resolution =
        this.options.approvalWaiter.resolutionForToolCallOrScope({
          ...scope,
          toolCallId,
          toolName: tool,
          normalizedArgs: args,
        });
      if (resolution?.status === "denied") {
        await this.record(
          {
            toolCallId,
            toolName: tool,
            status: "failed",
            lifecycleSeq: 3,
            error: resolution.denialError ?? {
              code: "POLICY_DENIED",
              message: "Approval denied",
            },
          },
          context,
        );
        return {
          content: resolution.denialError?.message ?? "Approval denied",
          details: {
            error: resolution.denialError ?? { code: "POLICY_DENIED" },
          },
        };
      }
      if (
        resolution?.status === "granted" &&
        resolution.toolCallId === toolCallId
      ) {
        const approvedHash =
          resolution.argsHash ?? sandboxSha256Digest(resolution.normalizedArgs);
        const actualHash = sandboxSha256Digest(args);
        if (approvedHash !== actualHash) {
          await this.record(
            {
              toolCallId,
              toolName: tool,
              status: "failed",
              lifecycleSeq: 3,
              error: {
                code: "VALIDATION_FAILED",
                message: "Tool arguments differ from approved arguments",
              },
            },
            context,
          );
          return {
            content: "Tool arguments differ from approved arguments",
            details: { error: { code: "VALIDATION_FAILED" } },
          };
        }
      }
      if (!resolution) {
        await this.options.approvalWaiter.request({
          id: toolCallId,
          toolCallId,
          conversationId:
            scopeValue(context, "conversationId") ?? "conv_unknown",
          agentId: scopeValue(context, "agentId") ?? "agent_main",
          runId: scopeValue(context, "runId") ?? "run_unknown",
          reason: decision.reason ?? "approval required",
          risk: [decision.reason ?? "policy"],
          normalizedArgs: args,
          displayArgs: this.redactor.redact(args),
          toolName: tool,
          argsHash: sandboxSha256Digest(args),
        });
        await this.record(
          {
            toolCallId,
            toolName: tool,
            status: "waiting_for_approval",
            approvalId: toolCallId,
            lifecycleSeq: 2,
          },
          context,
        );
        throw new AgentToolSuspension({
          toolCallId,
          toolName: tool,
          reason: `WAITING_FOR_APPROVAL: ${toolCallId}`,
        });
      }
    }
    if (isOrchestrationTool(tool)) {
      const result = await this.executeOrchestrationTool(
        tool,
        args,
        context,
        toolCallId,
      );
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "completed",
          lifecycleSeq: 3,
          result,
        },
        context,
      );
      return result;
    }
    await enforceToolPolicy(tool, args, this.config, this.options);
    await this.record(
      {
        toolCallId,
        toolName: tool,
        status: "started",
        lifecycleSeq: 2,
      },
      context,
    );
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
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "completed",
          lifecycleSeq: 3,
          result,
        },
        context,
      );
      return this.redactor.redact(result) as ToolExecutionResult;
    } catch (error) {
      await this.record(
        {
          toolCallId,
          toolName: tool,
          status: "failed",
          lifecycleSeq: 3,
          error: error instanceof Error ? error.message : String(error),
        },
        context,
      );
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
      const submitted =
        this.options.inputWaiter.resolutionForRequest(toolCallId);
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
      await this.record(
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

  private async record(
    entry: Record<string, unknown>,
    context?: Partial<ToolExecutionContext> & {
      conversationId?: string;
      agentId?: string;
      runId?: string;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    const record = this.redactor.redact({
      ...entry,
      ts: now,
    }) as Record<string, unknown>;
    await this.records.append(record);
    if (!context || !this.options.toolCallStore) return;
    const scope = toolScope(context);
    await this.options.toolCallStore.append(scope, {
      toolCallId: String(entry.toolCallId ?? "tool_unknown"),
      toolName: String(entry.toolName ?? "tool_unknown"),
      status: normalizeToolStatus(entry.status),
      displayArgs: entry.displayArgs,
      args: entry.displayArgs
        ? { hash: sandboxSha256Digest(entry.displayArgs) }
        : undefined,
      approvalId:
        typeof entry.approvalId === "string" ? entry.approvalId : undefined,
      lifecycleSeq:
        typeof entry.lifecycleSeq === "number" ? entry.lifecycleSeq : undefined,
      redactionVersion: 1,
      requestedAt: now,
      startedAt: entry.status === "started" ? now : undefined,
      completedAt:
        entry.status === "completed" || entry.status === "failed"
          ? now
          : undefined,
      result: entry.result,
      error: normalizeError(entry.error),
    });
  }
}

function toolScope(
  context: Partial<ToolExecutionContext> & {
    conversationId?: string;
    agentId?: string;
    runId?: string;
  },
) {
  return {
    conversationId: scopeValue(context, "conversationId") ?? "conv_unknown",
    agentId: scopeValue(context, "agentId") ?? "agent_main",
    runId: scopeValue(context, "runId") ?? "run_unknown",
  };
}

function normalizeToolStatus(status: unknown) {
  if (
    status === "requested" ||
    status === "waiting_for_approval" ||
    status === "started" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  )
    return status;
  return "failed" as const;
}

function normalizeError(error: unknown) {
  if (!error) return undefined;
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string")
      return { code: value.code, message: value.message };
  }
  return { code: "TOOL_FAILED", message: String(error).slice(0, 500) };
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
