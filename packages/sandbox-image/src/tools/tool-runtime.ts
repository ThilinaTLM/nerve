import path from "node:path";
import type { SandboxConfigV1, ToolName } from "@nervekit/shared";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "@nervekit/tools";
import { executeTool } from "@nervekit/tools";
import { Redactor } from "../security/redaction.js";
import { JsonlStore } from "../state/jsonl-store.js";
import type { ApprovalWaiter } from "./approval-waiter.js";
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
    const decision = this.decide(tool, args);
    if (decision.approvalRequired && this.options.approvalWaiter) {
      await this.options.approvalWaiter.request({
        id: toolCallId,
        toolCallId,
        reason: decision.reason ?? "approval required",
        risk: [decision.reason ?? "policy"],
        normalizedArgs: args,
      });
    } else if (!decision.allowed) {
      await this.record({
        toolCallId,
        toolName: tool,
        status: "failed",
        error: decision.reason,
      });
      throw new Error(decision.reason ?? "tool denied by sandbox policy");
    }
    await enforceToolPolicy(tool, args, this.config, this.options);
    if (isOrchestrationTool(tool)) {
      await this.record({
        toolCallId,
        toolName: tool,
        status: "failed",
        error: "orchestration wait required",
      });
      throw new Error(`${tool} is mediated by sandbox orchestration state`);
    }
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

  private async record(entry: Record<string, unknown>): Promise<void> {
    await this.records.append(
      this.redactor.redact({
        ...entry,
        ts: new Date().toISOString(),
      }) as Record<string, unknown>,
    );
  }
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
