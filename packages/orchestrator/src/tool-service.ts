import { join } from "node:path";
import type {
  AgentRecord,
  ApprovalRecord,
  ProcessRecord,
  StartProcessRequest,
  ToolCallRecord,
  ToolName,
  UserQuestionRecord,
  UserQuestionStatus,
} from "@nerve/shared";
import { createId } from "@nerve/shared";
import { allToolDescriptors, executeTool } from "@nerve/tools";
import type { EventBus } from "./events.js";
import type { IndexStore } from "./index-store.js";
import { evaluateToolPolicy } from "./policy.js";
import type { ProcessManager } from "./process-manager.js";
import type { InitializedStorage } from "./storage.js";
import { appendJsonLine, readJsonLines } from "./storage.js";

export interface ToolExecutionResponse {
  toolCall: ToolCallRecord;
  approval?: ApprovalRecord;
}

type ToolRequestOptions = {
  signal?: AbortSignal;
  sourceToolCallId?: string;
};

export type SubagentRunResult = {
  agent: AgentRecord;
  summary: string;
};

export type SubagentRunner = (
  parent: AgentRecord,
  args: Record<string, unknown>,
) => Promise<SubagentRunResult>;

export type ProcessStarter = (
  request: StartProcessRequest,
) => Promise<ProcessRecord>;

export class ToolService {
  readonly toolCalls = new Map<string, ToolCallRecord>();
  readonly approvals = new Map<string, ApprovalRecord>();
  readonly userQuestions = new Map<string, UserQuestionRecord>();
  private readonly waiters = new Map<
    string,
    Set<(toolCall: ToolCallRecord) => void>
  >();
  private readonly userQuestionWaiters = new Map<
    string,
    Set<(question: UserQuestionRecord) => void>
  >();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
    private readonly processes: ProcessManager,
    private readonly startProcess: ProcessStarter,
    private readonly getAgent: (agentId: string) => AgentRecord,
    private readonly runSubagent: SubagentRunner,
  ) {}

  async hydrate(): Promise<void> {
    for (const toolCall of await this.readLatestToolCalls()) {
      this.toolCalls.set(toolCall.id, toolCall);
      this.index.upsertToolCall(toolCall);
    }
    for (const approval of await this.readLatestApprovals()) {
      this.approvals.set(approval.id, approval);
      this.index.upsertApproval(approval);
    }
    for (const question of await this.readLatestUserQuestions()) {
      this.userQuestions.set(question.id, question);
      this.index.upsertUserQuestion(question);
    }
  }

  listTools() {
    return allToolDescriptors;
  }

  listToolCalls(): ToolCallRecord[] {
    return [...this.toolCalls.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
    return [...this.approvals.values()]
      .filter((approval) => !status || approval.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  listUserQuestions(status?: UserQuestionStatus): UserQuestionRecord[] {
    return [...this.userQuestions.values()]
      .filter((question) => !status || question.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async requestTool(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<ToolExecutionResponse> {
    const now = new Date().toISOString();
    const evaluation = evaluateToolPolicy(agent, toolName, args, {
      dataDir: this.storage.paths.home,
    });
    const toolCall: ToolCallRecord = {
      id: createId("tool"),
      agentId: agent.id,
      sessionId: agent.sessionId,
      projectId: agent.projectId,
      toolName,
      sourceToolCallId: options.sourceToolCallId,
      risk: evaluation.risk,
      args: evaluation.normalizedArgs,
      cwd: evaluation.cwd,
      status: "requested",
      createdAt: now,
      updatedAt: now,
    };
    await this.upsertToolCall(toolCall);
    await this.events.publish("agent.tool_call.requested", { toolCall });
    await this.events.publish("policy.evaluated", {
      toolCallId: toolCall.id,
      agentId: agent.id,
      sessionId: agent.sessionId,
      projectId: agent.projectId,
      toolName,
      risk: evaluation.risk,
      decision: evaluation.decision,
      reason: evaluation.reason,
    });

    if (evaluation.decision === "deny") {
      const denied = await this.updateToolCall(toolCall.id, {
        status: "denied",
        error: evaluation.reason,
      });
      await this.events.publish("agent.tool_call.denied", {
        toolCall: denied,
        reason: evaluation.reason,
      });
      return { toolCall: denied };
    }

    if (evaluation.decision === "approval") {
      const approval: ApprovalRecord = {
        id: createId("approval"),
        toolCallId: toolCall.id,
        agentId: agent.id,
        sessionId: agent.sessionId,
        projectId: agent.projectId,
        risk: evaluation.risk,
        reason: evaluation.reason,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      await this.upsertApproval(approval);
      const pending = await this.updateToolCall(toolCall.id, {
        status: "pending_approval",
        approvalId: approval.id,
      });
      await this.events.publish("approval.requested", {
        approval,
        toolCall: pending,
      });
      return { toolCall: pending, approval };
    }

    return { toolCall: await this.executeAllowedTool(toolCall.id, options) };
  }

  async requestToolAndWait(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
    options: ToolRequestOptions = {},
  ): Promise<ToolCallRecord> {
    const response = await this.requestTool(agent, toolName, args, options);
    if (isTerminalToolCall(response.toolCall)) return response.toolCall;
    if (response.toolCall.status !== "pending_approval")
      return response.toolCall;
    if (options.signal?.aborted) throw new Error("Tool execution aborted.");

    return new Promise<ToolCallRecord>((resolve, reject) => {
      const toolCallId = response.toolCall.id;
      const settle = (toolCall: ToolCallRecord) => {
        cleanup();
        resolve(toolCall);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Tool execution aborted."));
      };
      const cleanup = () => {
        const waiters = this.waiters.get(toolCallId);
        waiters?.delete(settle);
        if (waiters && waiters.size === 0) this.waiters.delete(toolCallId);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const current = this.getToolCall(toolCallId);
      if (isTerminalToolCall(current)) {
        resolve(current);
        return;
      }

      let waiters = this.waiters.get(toolCallId);
      if (!waiters) {
        waiters = new Set();
        this.waiters.set(toolCallId, waiters);
      }
      waiters.add(settle);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async grantApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    const approval = this.getPendingApproval(approvalId);
    const granted: ApprovalRecord = {
      ...approval,
      status: "granted",
      resolvedAt: new Date().toISOString(),
    };
    await this.upsertApproval(granted);
    await this.events.publish("approval.granted", { approval: granted, note });
    const toolCall = this.getToolCall(granted.toolCallId);
    return this.executeAllowedTool(toolCall.id);
  }

  async denyApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    const approval = this.getPendingApproval(approvalId);
    const deniedApproval: ApprovalRecord = {
      ...approval,
      status: "denied",
      resolvedAt: new Date().toISOString(),
    };
    await this.upsertApproval(deniedApproval);
    const deniedToolCall = await this.updateToolCall(approval.toolCallId, {
      status: "denied",
      error: note ?? "Denied by user.",
    });
    await this.events.publish("approval.denied", {
      approval: deniedApproval,
      note,
    });
    await this.events.publish("agent.tool_call.denied", {
      toolCall: deniedToolCall,
      reason: note ?? "Denied by user.",
    });
    return deniedToolCall;
  }

  async answerUserQuestion(
    questionId: string,
    answer: string,
  ): Promise<UserQuestionRecord> {
    const question = this.getPendingUserQuestion(questionId);
    const updated: UserQuestionRecord = {
      ...question,
      status: "answered",
      answer,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.upsertUserQuestion(updated);
    await this.events.publish("user_question.answered", { question: updated });
    this.notifyUserQuestionWaiters(updated);
    return updated;
  }

  async dismissUserQuestion(
    questionId: string,
    reason?: string,
  ): Promise<UserQuestionRecord> {
    const question = this.getPendingUserQuestion(questionId);
    const updated: UserQuestionRecord = {
      ...question,
      status: "dismissed",
      dismissedReason: reason ?? "Dismissed by user.",
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.upsertUserQuestion(updated);
    await this.events.publish("user_question.dismissed", { question: updated });
    this.notifyUserQuestionWaiters(updated);
    return updated;
  }

  getToolCall(toolCallId: string): ToolCallRecord {
    const toolCall = this.toolCalls.get(toolCallId);
    if (!toolCall) throw new Error("Tool call not found.");
    return toolCall;
  }

  private getPendingApproval(approvalId: string): ApprovalRecord {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "pending")
      throw new Error("Approval is already resolved.");
    return approval;
  }

  private getPendingUserQuestion(questionId: string): UserQuestionRecord {
    const question = this.userQuestions.get(questionId);
    if (!question) throw new Error("User question not found.");
    if (question.status !== "pending")
      throw new Error("User question is already resolved.");
    return question;
  }

  private async executeAllowedTool(
    toolCallId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ToolCallRecord> {
    const toolCall = await this.updateToolCall(toolCallId, {
      status: "running",
    });
    await this.events.publish("agent.tool_call.running", { toolCall });
    try {
      const args = { ...(toolCall.args as Record<string, unknown>) };
      const result = await this.executeToolCall(toolCall, args, options);
      const completed = await this.updateToolCall(toolCall.id, {
        status: "completed",
        result,
        error: undefined,
      });
      await this.events.publish("agent.tool_call.completed", {
        toolCall: completed,
      });
      return completed;
    } catch (error) {
      const failed = await this.updateToolCall(toolCall.id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      await this.events.publish("agent.tool_call.error", { toolCall: failed });
      return failed;
    }
  }

  private async executeToolCall(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    switch (toolCall.toolName) {
      case "process_start":
        return {
          process: await this.startProcess({
            name: typeof args.name === "string" ? args.name : undefined,
            workerId: this.getAgent(toolCall.agentId).workerId,
            projectId: toolCall.projectId,
            sessionId: toolCall.sessionId,
            agentId: toolCall.agentId,
            cwd: toolCall.cwd,
            command: stringArg(args, "command"),
            env: stringRecordArg(args.env),
            readyOnUrl: Boolean(args.readyOnUrl),
            readyPattern:
              typeof args.readyPattern === "string"
                ? args.readyPattern
                : undefined,
            readyTimeoutMs:
              typeof args.readyTimeoutMs === "number"
                ? args.readyTimeoutMs
                : undefined,
          }),
        };
      case "process_stop":
        return {
          process: await this.processes.stopProcess(
            processIdArg(args, this.processes, toolCall.projectId),
            {
              signal:
                args.signal === "SIGINT" ||
                args.signal === "SIGKILL" ||
                args.signal === "SIGTERM"
                  ? args.signal
                  : undefined,
              timeoutMs:
                typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
            },
          ),
        };
      case "process_restart":
        return {
          process: await this.processes.restartProcess(
            processIdArg(args, this.processes, toolCall.projectId),
          ),
        };
      case "process_list":
        return {
          processes: this.processes
            .listProcesses()
            .filter((process) => process.projectId === toolCall.projectId),
        };
      case "process_logs":
        return this.processes.queryLogs(
          processIdArg(args, this.processes, toolCall.projectId),
          {
            mode:
              args.mode === "errors" ||
              args.mode === "warnings" ||
              args.mode === "since_cursor" ||
              args.mode === "first_failure" ||
              args.mode === "recent"
                ? args.mode
                : undefined,
            sinceSeq:
              typeof args.sinceSeq === "number" ? args.sinceSeq : undefined,
            contains:
              typeof args.contains === "string" ? args.contains : undefined,
            regex: typeof args.regex === "string" ? args.regex : undefined,
            contextLines:
              typeof args.contextLines === "number"
                ? args.contextLines
                : undefined,
            limit: typeof args.limit === "number" ? args.limit : undefined,
          },
        );
      case "subagent_run":
        return this.runSubagent(this.getAgent(toolCall.agentId), args);
      case "ask_user":
        return this.requestUserQuestion(toolCall, args, options);
      default:
        if (toolCall.toolName === "bash") delete args.cwd;
        return executeTool(toolCall.toolName, args, {
          cwd: toolCall.cwd,
          signal: options.signal,
        });
    }
  }

  private async requestUserQuestion(
    toolCall: ToolCallRecord,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const now = new Date().toISOString();
    const question: UserQuestionRecord = {
      id: createId("question"),
      toolCallId: toolCall.id,
      agentId: toolCall.agentId,
      sessionId: toolCall.sessionId,
      projectId: toolCall.projectId,
      question: stringArg(args, "question"),
      context: optionalStringArg(args.context),
      recommendation: optionalStringArg(args.recommendation),
      placeholder: optionalStringArg(args.placeholder),
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    };
    await this.upsertUserQuestion(question);
    const waitingToolCall = await this.updateToolCall(toolCall.id, {
      status: "waiting_for_user",
    });
    await this.events.publish("agent.tool_call.waiting_for_user", {
      toolCall: waitingToolCall,
    });
    await this.events.publish("user_question.requested", {
      question,
      toolCall: waitingToolCall,
    });

    const resolved = await this.waitForUserQuestion(
      question.id,
      options.signal,
    );
    return {
      question: resolved.question,
      context: resolved.context,
      recommendation: resolved.recommendation,
      response: resolved.answer,
      dismissed: resolved.status === "dismissed",
      dismissedReason: resolved.dismissedReason,
    };
  }

  private waitForUserQuestion(
    questionId: string,
    signal?: AbortSignal,
  ): Promise<UserQuestionRecord> {
    if (signal?.aborted) {
      void this.dismissUserQuestion(questionId, "Agent run aborted.").catch(
        () => undefined,
      );
    }

    return new Promise<UserQuestionRecord>((resolve) => {
      const settle = (question: UserQuestionRecord) => {
        if (question.status === "pending") return;
        cleanup();
        resolve(question);
      };
      const onAbort = () => {
        void this.dismissUserQuestion(questionId, "Agent run aborted.").catch(
          () => undefined,
        );
      };
      const cleanup = () => {
        const waiters = this.userQuestionWaiters.get(questionId);
        waiters?.delete(settle);
        if (waiters && waiters.size === 0)
          this.userQuestionWaiters.delete(questionId);
        signal?.removeEventListener("abort", onAbort);
      };

      const current = this.userQuestions.get(questionId);
      if (current && current.status !== "pending") {
        resolve(current);
        return;
      }

      let waiters = this.userQuestionWaiters.get(questionId);
      if (!waiters) {
        waiters = new Set();
        this.userQuestionWaiters.set(questionId, waiters);
      }
      waiters.add(settle);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    const updated: ToolCallRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertToolCall(updated);
    if (isTerminalToolCall(updated)) this.notifyWaiters(updated);
    return updated;
  }

  private async upsertToolCall(toolCall: ToolCallRecord): Promise<void> {
    this.toolCalls.set(toolCall.id, toolCall);
    this.index.upsertToolCall(toolCall);
    await appendJsonLine(this.toolCallsPath(), toolCall, 0o600);
  }

  private notifyWaiters(toolCall: ToolCallRecord): void {
    const waiters = this.waiters.get(toolCall.id);
    if (!waiters) return;
    this.waiters.delete(toolCall.id);
    for (const waiter of waiters) waiter(toolCall);
  }

  private notifyUserQuestionWaiters(question: UserQuestionRecord): void {
    const waiters = this.userQuestionWaiters.get(question.id);
    if (!waiters) return;
    this.userQuestionWaiters.delete(question.id);
    for (const waiter of waiters) waiter(question);
  }

  private async upsertApproval(approval: ApprovalRecord): Promise<void> {
    this.approvals.set(approval.id, approval);
    this.index.upsertApproval(approval);
    await appendJsonLine(this.approvalsPath(), approval, 0o600);
  }

  private async upsertUserQuestion(
    question: UserQuestionRecord,
  ): Promise<void> {
    this.userQuestions.set(question.id, question);
    this.index.upsertUserQuestion(question);
    await appendJsonLine(this.userQuestionsPath(), question, 0o600);
  }

  private async readLatestToolCalls(): Promise<ToolCallRecord[]> {
    const values = await readJsonLines<ToolCallRecord>(
      this.toolCallsPath(),
    ).catch(() => []);
    return latestById(values);
  }

  private async readLatestApprovals(): Promise<ApprovalRecord[]> {
    const values = await readJsonLines<ApprovalRecord>(
      this.approvalsPath(),
    ).catch(() => []);
    return latestById(values);
  }

  private async readLatestUserQuestions(): Promise<UserQuestionRecord[]> {
    const values = await readJsonLines<UserQuestionRecord>(
      this.userQuestionsPath(),
    ).catch(() => []);
    return latestById(values);
  }

  private toolCallsPath(): string {
    return join(this.storage.paths.home, "logs", "tool-calls.jsonl");
  }

  private approvalsPath(): string {
    return join(this.storage.paths.home, "approvals", "approvals.jsonl");
  }

  private userQuestionsPath(): string {
    return join(
      this.storage.paths.home,
      "user-questions",
      "user-questions.jsonl",
    );
  }
}

function isTerminalToolCall(toolCall: ToolCallRecord): boolean {
  return (
    toolCall.status === "completed" ||
    toolCall.status === "denied" ||
    toolCall.status === "error"
  );
}

function latestById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()];
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Tool argument '${name}' must be a non-empty string.`);
  }
  return value;
}

function optionalStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function stringRecordArg(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") output[key] = raw;
  }
  return output;
}

function processIdArg(
  args: Record<string, unknown>,
  processes: ProcessManager,
  projectId: string,
): string {
  let processId: string | undefined;
  if (typeof args.processId === "string" && args.processId.trim()) {
    processId = args.processId;
  } else if (typeof args.name === "string" && args.name.trim()) {
    processId = processes
      .listProcesses()
      .find(
        (process) =>
          process.name === args.name && process.projectId === projectId,
      )?.id;
  }
  if (!processId) {
    throw new Error("Tool argument 'processId' or 'name' is required.");
  }
  const process = processes.getProcess(processId);
  if (process.projectId !== projectId) {
    throw new Error("Process is outside this agent's project scope.");
  }
  return process.id;
}
