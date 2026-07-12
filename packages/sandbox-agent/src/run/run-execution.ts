import {
  type AgentHarness,
  type AgentMessage,
  isAgentToolSuspension,
} from "@nervekit/host-runtime/harness";
import {
  toolNameSchema,
  type RunPromptRecord,
  type RunRecord,
  type ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type {
  CheckpointCommand,
  RunExecution,
  RunExecutionControl,
  RunExecutionFactoryPort,
  RunExecutionOutcome,
  RunExecutionSink,
  WaitCommand,
} from "@nervekit/host-runtime";
import {
  createNoopLogger,
  findExecutableCommandBlocks,
  formatInlineCommandResultText,
  parseInlineCommandPrompt,
  replaceExecutableCommandBlocks,
  type SandboxConfigV1,
  type StructuredLogger,
} from "@nervekit/contracts";
import type { AgentConfigStore } from "../agent/agent-config-store.js";
import type { HarnessFactory } from "../agent/harness-factory.js";
import { sandboxSha256Digest } from "../state/hash.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type { SandboxInteractionChannel } from "./interaction-channel.js";
import type { SandboxLiveHarnessRegistry } from "./live-registry.js";
import type { SandboxPendingInteractions } from "./pending-interactions.js";
import type { SandboxRunReferences } from "./run-references.js";

const NOOP_LOGGER = createNoopLogger();

export interface SandboxRunExecutionDeps {
  config: SandboxConfigV1;
  harnessFactory: HarnessFactory;
  references: SandboxRunReferences;
  live: SandboxLiveHarnessRegistry;
  channel: SandboxInteractionChannel;
  pending: SandboxPendingInteractions;
  toolRuntime?: SandboxToolRuntime;
  configStore?: AgentConfigStore;
  logger?: StructuredLogger;
}

/**
 * Constructs the real AgentHarness-backed execution for one run attempt. The
 * factory reports every durable lifecycle effect through the supplied
 * RunExecutionSink and never mutates canonical run state directly.
 */
export class SandboxRunExecutionFactory implements RunExecutionFactoryPort {
  constructor(private readonly deps: SandboxRunExecutionDeps) {}

  async create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution> {
    await this.deps.harnessFactory.assertModelAvailable();
    return new SandboxRunExecution(run, sink, this.deps);
  }
}

class SandboxRunExecution implements RunExecution {
  private harness?: AgentHarness;
  private readonly abort = new AbortController();
  private readonly toolCalls = new Map<string, ToolCallTranscriptRecord>();
  private projectionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly run: RunRecord,
    private readonly sink: RunExecutionSink,
    private readonly deps: SandboxRunExecutionDeps,
  ) {}

  readonly control: RunExecutionControl = {
    steer: async (prompt) => this.steer(prompt),
    followUp: async (prompt) => this.followUp(prompt),
    continue: async () => this.deliverResolution(),
    cancel: async () => {
      this.abort.abort("cancelled");
      await this.harness?.abort().catch(() => undefined);
    },
  };

  private get scope() {
    return {
      conversationId: this.run.conversationId,
      agentId: this.run.agentId,
      runId: this.run.runId,
      executionId: this.run.executionId,
    };
  }

  async execute(input: {
    run: RunRecord;
    command: "start" | "continue";
    prompt?: string;
    signal: AbortSignal;
  }): Promise<RunExecutionOutcome> {
    const log = (this.deps.logger ?? NOOP_LOGGER).child({
      runId: this.run.runId,
      executionId: this.run.executionId,
    });
    if (input.signal.aborted)
      return { status: "interrupted", message: "aborted" };
    input.signal.addEventListener("abort", () => this.abort.abort(), {
      once: true,
    });
    if (input.command === "continue") {
      await this.prepareResolvedPlanReview();
    }
    if (input.command === "start") {
      const prompt = input.prompt ?? "";
      const inline = parseInlineCommandPrompt(prompt);
      if (inline) return this.executeInline(inline.command);
    }
    let harness: AgentHarness;
    try {
      harness = await this.deps.harnessFactory.create(this.scope);
    } catch (error) {
      return { status: "failed", failure: normalizeFailure(error) };
    }
    this.harness = harness;
    this.deps.live.set(this.run.runId, { harness, abort: this.abort });
    const dispose = harness.subscribe((event) => {
      this.projectionTail = this.projectionTail
        .then(() => this.project(event))
        .catch((error) => log.warn("run projection failed", { err: error }));
    });
    try {
      if (input.command === "continue") {
        await harness.continue();
      } else {
        const prompt = await this.resolvePrompt(input.prompt ?? "");
        await this.appendUserEntry(prompt);
        await harness.prompt(prompt);
      }
      await this.projectionTail;
      if (this.abort.signal.aborted) {
        return { status: "interrupted", message: "aborted" };
      }
      await this.sink.checkpoint(
        await this.checkpointCommand("after_provider_response"),
      );
      return { status: "completed" };
    } catch (error) {
      if (isAgentToolSuspension(error)) {
        await this.enterWait(error.data.toolCallId, error.data.toolName);
        return { status: "suspended" };
      }
      const serialized = this.serializedSuspension(error);
      if (serialized) {
        await this.enterWait(
          serialized.toolCallId,
          serialized.toolName,
          serialized.detail,
        );
        return { status: "suspended" };
      }
      if (this.abort.signal.aborted) {
        return { status: "interrupted", message: "aborted" };
      }
      return { status: "failed", failure: normalizeFailure(error) };
    } finally {
      dispose();
      this.deps.live.delete(this.run.runId);
    }
  }

  private async prepareResolvedPlanReview(): Promise<void> {
    const state = await this.deps.references.loadRun(this.run.runId);
    const interaction = [...(state?.interactions ?? [])]
      .reverse()
      .find(
        (item) => item.kind === "plan_review" && item.status === "resolved",
      );
    if (!interaction || interaction.kind !== "plan_review") return;
    const decision = String(interaction.resolution?.decision ?? "accept");
    const feedback =
      typeof interaction.resolution?.feedback === "string"
        ? interaction.resolution.feedback
        : undefined;
    const resolvedPlanReview =
      interaction.resolution?.planReview &&
      typeof interaction.resolution.planReview === "object"
        ? interaction.resolution.planReview
        : interaction.planReview;
    const content = [
      `Plan review decision: ${decision}.`,
      feedback ? `Feedback: ${feedback}` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    const entryId = `entry_${sandboxSha256Digest(`${interaction.id}:${interaction.resolutionRequestId ?? "resolved"}`).slice(7, 23)}`;
    const conversation =
      await this.deps.harnessFactory.openOrCreateConversation(
        interaction.conversationId,
        interaction.agentId,
      );
    if (await conversation.getEntry(entryId)) return;
    await this.deps.harnessFactory.appendConversationMessage(
      interaction.conversationId,
      interaction.agentId,
      entryId,
      {
        role: "toolResult",
        toolCallId: interaction.toolCallId,
        toolName: "plan_mode_present",
        content: [{ type: "text", text: content }],
        details: {
          decision,
          feedback,
          planReview: resolvedPlanReview,
        },
        isError: false,
        timestamp: Date.now(),
      },
    );
  }

  private async appendUserEntry(prompt: string): Promise<void> {
    if (!prompt) return;
    await this.sink.appendEntries([
      {
        id: `entry_${sandboxSha256Digest(`${this.run.runId}:user:${this.run.attempt}`).slice(7, 23)}`,
        conversationId: this.run.conversationId,
        agentId: this.run.agentId,
        runId: this.run.runId,
        role: "user",
        kind: "message",
        text: prompt.slice(0, 200_000),
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  private async executeInline(command: string): Promise<RunExecutionOutcome> {
    const runtime = this.deps.toolRuntime;
    if (!runtime) {
      return {
        status: "failed",
        failure: {
          code: "UNAVAILABLE",
          message: "Inline command tool runtime is unavailable",
          retryable: false,
        },
      };
    }
    try {
      const providerToolCallId = `inline_${sandboxSha256Digest(`${this.run.runId}:${command}`).slice(7, 23)}`;
      const started = this.toolCallRecord(
        providerToolCallId,
        "bash",
        "running",
        { command },
      );
      if (started) await this.sink.upsertToolCalls([started]);
      const result = await runtime.execute(
        "bash",
        { command },
        {
          ...this.scope,
          toolCallId: providerToolCallId,
          signal: this.abort.signal,
        },
      );
      const completed = this.toolCallRecord(
        providerToolCallId,
        "bash",
        "completed",
        undefined,
        result,
      );
      if (completed) await this.sink.upsertToolCalls([completed]);
      const text = formatInlineCommandResultText({
        command,
        output: result.content || "(no output)",
        status: "completed",
        exitCode: result.exitCode,
      });
      await this.sink.appendEntries([
        {
          id: `entry_${sandboxSha256Digest(`${this.run.runId}:inline:${this.run.attempt}`).slice(7, 23)}`,
          conversationId: this.run.conversationId,
          agentId: this.run.agentId,
          runId: this.run.runId,
          role: "system",
          kind: "message",
          text: text.slice(0, 200_000),
          details: { type: "inline_command_result", command },
          createdAt: new Date().toISOString(),
        },
      ]);
      return { status: "completed" };
    } catch (error) {
      return { status: "failed", failure: normalizeFailure(error) };
    }
  }

  private async resolvePrompt(prompt: string): Promise<string> {
    if (findExecutableCommandBlocks(prompt).length === 0) return prompt;
    const runtime = this.deps.toolRuntime;
    if (!runtime) return prompt;
    const replacements = [];
    for (const block of findExecutableCommandBlocks(prompt)) {
      const result = await runtime.execute(
        "bash",
        { command: block.command },
        { ...this.scope, signal: this.abort.signal },
      );
      replacements.push({
        block,
        text: formatInlineCommandResultText({
          command: block.command,
          output: result.content || "(no output)",
          status: "completed",
          exitCode: result.exitCode,
        }),
      });
    }
    return replaceExecutableCommandBlocks(prompt, replacements);
  }

  private async steer(prompt: RunPromptRecord): Promise<void> {
    await this.harness?.steer(prompt.text, { id: prompt.id });
  }

  private async followUp(prompt: RunPromptRecord): Promise<void> {
    await this.harness?.followUp(prompt.text, { id: prompt.id });
  }

  /**
   * Called by the coordinator after resolveInteraction commits. Delivers the
   * durable resolution to the live tool awaiting on the interaction channel.
   */
  private async deliverResolution(): Promise<void> {
    const state = await this.deps.references.loadRun(this.run.runId);
    if (!state) return;
    for (const interaction of state.interactions) {
      if (interaction.status === "resolved" && interaction.resolution) {
        this.deps.channel.deliver(interaction.id, interaction.resolution);
      }
    }
  }

  private serializedSuspension(error: unknown):
    | {
        toolCallId: string;
        toolName: string;
        detail: import("./pending-interactions.js").PendingInteractionDetail;
      }
    | undefined {
    const message = error instanceof Error ? error.message : String(error);
    const match = /WAITING_FOR_(INPUT|APPROVAL|PLAN_REVIEW):\s*(\S+)/.exec(
      message,
    );
    if (!match) return undefined;
    const pending = this.deps.pending.takeForSignal(match[2]!);
    if (!pending) return undefined;
    return {
      ...pending,
      toolName:
        match[1] === "INPUT"
          ? "ask_user"
          : match[1] === "PLAN_REVIEW"
            ? "plan_mode_present"
            : "tool",
    };
  }

  private async enterWait(
    toolCallId: string,
    toolName: string,
    knownDetail?: import("./pending-interactions.js").PendingInteractionDetail,
  ): Promise<void> {
    const command = knownDetail ?? this.deps.pending.take(toolCallId);
    const interactionId = command?.interactionId ?? toolCallId;
    const waitKind = command?.kind ?? "question";
    // Commit the final waiting tool revision before capturing checkpoint
    // references so restart validation observes the same lifecycle revision.
    const currentTool = this.toolCalls.get(toolCallId);
    if (currentTool) {
      const updated: ToolCallTranscriptRecord = {
        ...currentTool,
        status:
          waitKind === "approval" ? "pending_approval" : "waiting_for_user",
        updatedAt: new Date().toISOString(),
      };
      this.toolCalls.set(toolCallId, updated);
      await this.sink.upsertToolCalls([updated]);
    }
    const checkpoint = await this.checkpointCommand(
      "suspension",
      interactionId,
    );
    const wait: WaitCommand = command
      ? { ...command, interactionId, toolCallId, checkpoint }
      : {
          kind: "question",
          interactionId,
          toolCallId,
          prompt: `Waiting on ${toolName}`,
          required: true,
          checkpoint,
        };
    await this.sink.wait(wait);
  }

  private async checkpointCommand(
    boundary: CheckpointCommand["boundary"],
    interactionId?: string,
  ): Promise<CheckpointCommand> {
    const transcript = await this.deps.references.transcript(this.run.runId);
    const toolCalls = await this.deps.references.toolCalls(this.run.runId);
    return {
      boundary,
      transcriptCursor: transcript.cursor,
      entryIds: transcript.entryIds,
      harnessLeafId: transcript.harnessLeafId,
      harnessSavePointId: transcript.harnessSavePointId,
      toolCalls: toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        lifecycleRevision: call.lifecycleRevision,
      })),
      interactionId,
    };
  }

  private async project(event: {
    type: string;
    message?: AgentMessage;
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
  }): Promise<void> {
    if (
      event.type === "tool_execution_start" &&
      event.toolCallId &&
      event.toolName
    ) {
      const record = this.toolCallRecord(
        event.toolCallId,
        event.toolName,
        "running",
        event.args,
      );
      if (record) await this.sink.upsertToolCalls([record]);
      return;
    }
    if (
      event.type === "tool_execution_end" &&
      event.toolCallId &&
      event.toolName
    ) {
      const record = this.toolCallRecord(
        event.toolCallId,
        event.toolName,
        event.isError ? "error" : "completed",
        undefined,
        event.result,
      );
      if (record) await this.sink.upsertToolCalls([record]);
      return;
    }
    if (event.type === "message_update") {
      this.sink.progress({
        type: "conversation.live.updated",
        occurredAt: new Date().toISOString(),
        data: {
          conversationId: this.run.conversationId,
          agentId: this.run.agentId,
          runId: this.run.runId,
        },
      });
      return;
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = messageText(event.message);
      if (!text) return;
      await this.sink.appendEntries([
        {
          id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          conversationId: this.run.conversationId,
          agentId: this.run.agentId,
          runId: this.run.runId,
          role: "assistant",
          kind: "message",
          text: text.slice(0, 200_000),
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  }

  private toolCallRecord(
    providerToolCallId: string,
    toolName: string,
    status: ToolCallTranscriptRecord["status"],
    args?: unknown,
    result?: unknown,
  ): ToolCallTranscriptRecord | undefined {
    const parsedName = toolNameSchema.safeParse(toolName);
    if (!parsedName.success) return undefined;
    const now = new Date().toISOString();
    const id = `tool_${sandboxSha256Digest(providerToolCallId).slice(7, 23)}`;
    const previous = this.toolCalls.get(providerToolCallId);
    const record: ToolCallTranscriptRecord = {
      id,
      agentId: this.run.agentId,
      conversationId: this.run.conversationId,
      projectId: this.run.projectId,
      runId: this.run.runId,
      turnId: `turn_${sandboxSha256Digest(`${this.run.runId}:${this.run.attempt}`).slice(7, 23)}`,
      liveMessageId: `msg_${sandboxSha256Digest(`${this.run.runId}:${providerToolCallId}`).slice(7, 23)}`,
      contentIndex: 0,
      toolName: parsedName.data,
      providerToolCallId,
      risk: toolRisk(parsedName.data),
      cwd: this.deps.config.agent.workspaceRoot ?? process.cwd(),
      status,
      argsPreview: args ?? previous?.argsPreview,
      resultPreview: previewResult(result),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.toolCalls.set(providerToolCallId, record);
    return record;
  }
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && "text" in block
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");
}

function previewResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const content = (result as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text?: unknown }).text ?? "")
          : "",
      )
      .join("");
    return text ? { content: text } : result;
  }
  return result;
}

function toolRisk(toolName: string): ToolCallTranscriptRecord["risk"] {
  if (["ask_user", "plan_mode_present", "plan_mode_enter"].includes(toolName))
    return "interaction";
  if (toolName === "bash") return "command";
  if (["write", "edit"].includes(toolName)) return "workspace_write";
  if (["explore", "task_start"].includes(toolName)) return "agent_spawn";
  return "read";
}

function normalizeFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: message.startsWith("UNAVAILABLE") ? "UNAVAILABLE" : "PROVIDER_FAILED",
    message: message.slice(0, 2_000),
    retryable: true,
  };
}
