import type { AgentRecord, Mode, ToolCallRecord } from "@nerve/shared";
import { executeTool, type ToolExecutionOutputUpdate } from "@nerve/tools";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";
import type { ConversationRuntime } from "../conversations/conversation-runtime.js";
import { ensurePlanDir } from "../plans/plan-paths.js";
import type { PlanService } from "../plans/plan-service.js";
import type { ProcessManager } from "../processes/process-manager.js";
import type { InteractionSessionService } from "./interaction-session.service.js";
import type { TodoStateService } from "./todo-state.service.js";
import { todoItemsArg, todosResult } from "./todo-state.service.js";
import {
  optionalFiniteNumberArg,
  optionalStringArg,
  processIdArg,
  signalArg,
  stringArg,
  stringRecordArg,
} from "./tool-args.js";
import { ToolExecutionSuspended } from "./tool-execution-suspension.js";
import type {
  ExploreProgressUpdate,
  ExploreRunner,
  ProcessStarter,
  ToolRequestOptions,
} from "./tool-service.js";

export interface OrchestrationToolDispatcherDeps {
  storage: InitializedStorage;
  events: EventBus;
  processes: ProcessManager;
  startProcess: ProcessStarter;
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
      case "process_start":
        return {
          process: await this.deps.startProcess({
            name: typeof args.name === "string" ? args.name : undefined,
            workerId: this.deps.getAgent(toolCall.agentId).workerId,
            projectId: toolCall.projectId,
            conversationId: toolCall.conversationId,
            agentId: toolCall.agentId,
            cwd: toolCall.cwd,
            command: stringArg(args, "command"),
            env: stringRecordArg(args.env),
            readyOnUrl: Boolean(args.readyOnUrl),
            readyPattern: optionalStringArg(args.readyPattern),
            readyTimeoutMs: optionalFiniteNumberArg(args.readyTimeoutMs),
          }),
        };
      case "process_stop":
        return {
          process: await this.deps.processes.stopProcess(
            processIdArg(args, this.deps.processes, toolCall.projectId),
            {
              signal: signalArg(args.signal),
              timeoutMs: optionalFiniteNumberArg(args.timeoutMs),
            },
          ),
        };
      case "process_restart":
        return {
          process: await this.deps.processes.restartProcess(
            processIdArg(args, this.deps.processes, toolCall.projectId),
          ),
        };
      case "process_list":
        return {
          processes: this.deps.processes
            .listProcesses()
            .filter((process) => process.projectId === toolCall.projectId),
        };
      case "process_logs":
        return this.deps.processes.queryLogs(
          processIdArg(args, this.deps.processes, toolCall.projectId),
          {
            mode:
              args.mode === "errors" ||
              args.mode === "warnings" ||
              args.mode === "since_cursor" ||
              args.mode === "first_failure" ||
              args.mode === "recent"
                ? args.mode
                : undefined,
            sinceSeq: optionalFiniteNumberArg(args.sinceSeq),
            contains: optionalStringArg(args.contains),
            regex: optionalStringArg(args.regex),
            contextLines: optionalFiniteNumberArg(args.contextLines),
            limit: optionalFiniteNumberArg(args.limit),
          },
        );
      case "explore":
        return this.deps.runExplore(
          this.deps.getAgent(toolCall.agentId),
          args,
          {
            onProgress: (message) =>
              this.publishExploreProgress(toolCall, message, options.runId),
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
      default:
        if (toolCall.toolName === "bash") delete args.cwd;
        return executeTool(toolCall.toolName, args, {
          cwd: toolCall.cwd,
          signal: options.signal,
          dataDir: this.deps.storage.paths.home,
          getApiKey: this.deps.getApiKey,
          onUpdate: (update) =>
            this.publishToolExecutionUpdate(toolCall, update, options.runId),
        });
    }
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
