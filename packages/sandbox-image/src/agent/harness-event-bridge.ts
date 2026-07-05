// biome-ignore lint/style/noExcessiveLinesPerFile: Bridge centralizes legacy and rich sandbox harness event fanout during migration.
import type {
  AgentHarness,
  AgentHarnessEvent,
  AgentToolResult,
} from "@nervekit/agent";
import {
  ConversationRuntime,
  type ToolCallTranscriptRecord,
  toolNameSchema,
} from "@nervekit/shared";
import type { ArtifactStore } from "../state/artifacts.js";
import type { EventOutbox } from "../state/event-outbox.js";
import { sandboxSha256Digest } from "../state/hash.js";
import type { ApprovalWaiter } from "../tools/approval-waiter.js";
import type { InputWaiter } from "../tools/input-waiter.js";
import type { RunManager, RunScope } from "./run-manager.js";
import type { RunState } from "./run-state-store.js";

export type HarnessRunContext = RunScope & {
  executionId: string;
  commandId?: string;
};

type LiveRunState = {
  turnId?: string;
  liveMessageId?: string;
  lastAssistantEntryId?: string;
};

export class HarnessEventBridge {
  private deltaCounter = 0;
  private transcriptIndex = 1;
  private readonly conversationRuntime = new ConversationRuntime();
  private readonly liveRuns = new Map<string, LiveRunState>();
  constructor(
    private readonly events?: EventOutbox,
    private readonly runs?: RunManager,
    private readonly waiters: {
      input?: InputWaiter;
      approval?: ApprovalWaiter;
    } = {},
    private readonly commonData: Record<string, unknown> = {},
    private readonly artifacts?: ArtifactStore,
  ) {}

  attach(harness: AgentHarness, context: HarnessRunContext): () => void {
    return harness.subscribe((event) => this.handle(event, context));
  }

  async startRun(
    context: HarnessRunContext,
    parentEntryId?: string,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    this.conversationRuntime.startRun({
      conversationId: context.conversationId,
      agentId: context.agentId,
      projectId: this.projectId(),
      runId: context.runId,
      startedAt,
    });
    this.liveRuns.set(context.runId, {});
    await this.events?.append({
      type: "conversation.run.started",
      durability: "durable",
      conversationId: context.conversationId,
      agentId: context.agentId,
      runId: context.runId,
      data: {
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        projectId: this.projectId(),
        parentEntryId,
        startedAt,
      },
    });
  }

  async completeRun(context: RunScope): Promise<void> {
    const state = this.liveRuns.get(context.runId);
    const completedAt = new Date().toISOString();
    await this.events?.append({
      type: "conversation.run.completed",
      durability: "durable",
      conversationId: context.conversationId,
      agentId: context.agentId,
      runId: context.runId,
      data: {
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        projectId: this.projectId(),
        finalEntryId: state?.lastAssistantEntryId,
        completedAt,
      },
    });
    this.conversationRuntime.completeRun(context.runId);
    this.liveRuns.delete(context.runId);
  }

  activeRunSnapshot(conversationId: string) {
    return this.conversationRuntime.snapshotForConversation(conversationId);
  }

  async failRun(
    context: RunScope,
    error: { message?: string } = {},
    aborted = false,
  ): Promise<void> {
    const failedAt = new Date().toISOString();
    await this.events?.append({
      type: "conversation.run.failed",
      durability: "durable",
      conversationId: context.conversationId,
      agentId: context.agentId,
      runId: context.runId,
      data: {
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        projectId: this.projectId(),
        message: bound(
          error.message ?? (aborted ? "run cancelled" : "run failed"),
          500,
        ),
        aborted,
        failedAt,
      },
    });
    this.conversationRuntime.failRun(context.runId);
    this.liveRuns.delete(context.runId);
  }

  async handleSuspension(
    context: HarnessRunContext,
    suspension: {
      data: { toolCallId: string; toolName: string; reason: string };
    },
  ): Promise<void> {
    const input = this.waiters.input?.get(suspension.data.toolCallId);
    if (input) {
      const checkpoint = await this.runs?.writeCheckpoint(
        context,
        "tool_wait",
        {
          status: "waiting_for_input",
          executionId: context.executionId,
          toolCallId: suspension.data.toolCallId,
          waitId: input.requestId,
          summary: { text: "waiting for user input" },
          data: { toolName: suspension.data.toolName },
        },
      );
      await this.runs?.markWaiting(context, "input", {
        requestId: input.requestId,
        question: input.redactedDisplay ?? input.question,
        placeholder: input.placeholder,
        required: true,
        createdAt: input.createdAt,
        checkpointId: checkpoint?.checkpointId,
      });
      return;
    }
    const approval = this.waiters.approval
      ?.list()
      .find((entry) => entry.toolCallId === suspension.data.toolCallId);
    if (approval) {
      const checkpoint = await this.runs?.writeCheckpoint(
        context,
        "tool_wait",
        {
          status: "waiting_for_approval",
          executionId: context.executionId,
          toolCallId: approval.toolCallId,
          waitId: approval.approvalId,
          summary: { text: "waiting for tool approval" },
          data: { toolName: suspension.data.toolName },
        },
      );
      await this.runs?.markWaiting(context, "approval", {
        approvalId: approval.approvalId,
        toolCallId: approval.toolCallId,
        risk: approval.risk,
        reason: approval.reason,
        normalizedArgs: approval.normalizedArgs,
        offeredScopes: ["single_call", "same_tool_same_args", "run"],
        createdAt: approval.createdAt,
        checkpointId: checkpoint?.checkpointId,
      });
    }
  }

  async delta(run: RunState, text: string): Promise<void> {
    await this.events?.append({
      type: "run.delta",
      durability: "transient",
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      data: {
        ...this.commonData,
        ...scopeData(run),
        deltaId: `delta_${Date.now()}_${++this.deltaCounter}`,
        role: "assistant",
        text: bound(text),
      },
    });
  }

  async terminal(
    run: RunState,
    status: "completed" | "failed" | "cancelled",
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.events?.append({
      type:
        status === "completed"
          ? "run.completed"
          : status === "cancelled"
            ? "run.cancelled"
            : "run.failed",
      durability: "durable",
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      data: { ...this.commonData, ...scopeData(run), status, ...data },
    });
  }

  private async handle(
    event: AgentHarnessEvent,
    context: HarnessRunContext,
  ): Promise<void> {
    if (event.type === "message_start" && event.message.role === "assistant") {
      const turn = this.conversationRuntime.startTurn(context.runId);
      const started = this.conversationRuntime.startAssistantMessage(
        context.runId,
        turn.turnId,
      );
      this.liveRuns.set(context.runId, {
        ...(this.liveRuns.get(context.runId) ?? {}),
        turnId: turn.turnId,
        liveMessageId: started.liveMessageId,
      });
      await this.events?.append({
        type: "conversation.live.message.started",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data: started,
      });
      return;
    }
    if (event.type === "before_provider_request") {
      const checkpoint = await this.runs?.writeCheckpoint(
        context,
        "provider_request",
        {
          status: "running",
          executionId: context.executionId,
          summary: { text: "before provider request" },
        },
      );
      await this.events?.append({
        type: "run.checkpointed",
        durability: "durable",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data: {
          ...this.commonData,
          ...scopeData(context),
          checkpointId: checkpoint?.checkpointId ?? `provider_${Date.now()}`,
          status: "running",
          checkpointedAt: checkpoint?.createdAt ?? new Date().toISOString(),
        },
      });
      return;
    }
    if (event.type === "before_provider_payload") return;
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent as {
        type?: string;
        delta?: string;
        content?: string;
        contentIndex?: number;
        partial?: unknown;
        toolCall?: { id?: string; name?: string; arguments?: unknown };
      };
      await this.handleLegacyAssistantDelta(context, update);
      await this.handleRichAssistantUpdate(context, update);
      return;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const text = messageText(event.message);
      if (text) {
        const bounded = await this.boundedTranscriptContent(
          context,
          `assistant-${Date.now()}`,
          text,
        );
        const entryId = `entry_${Date.now()}_${this.transcriptIndex}`;
        const live = this.liveRuns.get(context.runId);
        if (live) live.lastAssistantEntryId = entryId;
        await this.runs?.appendTranscriptEntry(context, {
          entryId,
          index: this.transcriptIndex++,
          role: "assistant",
          content: bounded.content,
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (event.type === "tool_call") {
      const requestedAt = new Date().toISOString();
      const displayArgs = event.input;
      await this.runs?.toolCallStore().append(context, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "requested",
        displayArgs,
        args: { hash: sandboxSha256Digest(displayArgs) },
        lifecycleSeq: 1,
        redactionVersion: 1,
        requestedAt,
      });
      await this.publishToolCallUpdated(context, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "requested",
        argsPreview: displayArgs,
        createdAt: requestedAt,
        updatedAt: requestedAt,
      });
      await this.events?.append({
        type: "tool.call.requested",
        durability: "durable",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data: {
          ...this.commonData,
          ...scopeData(context),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "requested",
          displayArgs,
          lifecycleSeq: 1,
          requestedAt,
        },
      });
      return;
    }
    if (event.type === "tool_execution_start") {
      const startedAt = new Date().toISOString();
      await this.runs?.toolCallStore().append(context, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "started",
        displayArgs: event.args,
        args: { hash: sandboxSha256Digest(event.args) },
        lifecycleSeq: 2,
        redactionVersion: 1,
        requestedAt: startedAt,
        startedAt,
      });
      await this.publishToolCallUpdated(context, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "running",
        argsPreview: event.args,
        createdAt: startedAt,
        updatedAt: startedAt,
      });
      await this.events?.append({
        type: "tool.call.started",
        durability: "durable",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data: {
          ...this.commonData,
          ...scopeData(context),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "started",
          displayArgs: event.args,
          lifecycleSeq: 2,
          startedAt,
        },
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      const text = toolUpdateText(event.partialResult);
      if (text) {
        const live = this.liveRuns.get(context.runId);
        const data = this.conversationRuntime.applyToolOutputDelta({
          conversationId: context.conversationId,
          agentId: context.agentId,
          projectId: this.projectId(),
          runId: context.runId,
          turnId: live?.turnId,
          liveMessageId: live?.liveMessageId,
          providerToolCallId: event.toolCallId,
          toolCallId: normalizeToolCallId(event.toolCallId),
          toolName: event.toolName,
          stream: "combined",
          delta: bound(text),
        });
        await this.events?.append({
          type: "conversation.live.tool_output.delta",
          durability: "transient",
          conversationId: context.conversationId,
          agentId: context.agentId,
          runId: context.runId,
          data,
        });
      }
      if (text) {
        await this.events?.append({
          type: "run.delta",
          durability: "transient",
          conversationId: context.conversationId,
          agentId: context.agentId,
          runId: context.runId,
          data: {
            ...this.commonData,
            ...scopeData(context),
            deltaId: `delta_${Date.now()}_${++this.deltaCounter}`,
            role: "tool",
            text: bound(text),
          },
        });
      }
      return;
    }
    if (event.type === "tool_execution_end") {
      const status = event.isError ? "failed" : "completed";
      const completedAt = new Date().toISOString();
      const error = event.isError
        ? {
            code: "TOOL_FAILED",
            message: bound(toolUpdateText(event.result) || "tool failed"),
          }
        : undefined;
      const artifactRefs = await this.toolArtifactRefs(context, event.result);
      await this.runs?.toolCallStore().append(context, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status,
        lifecycleSeq: 3,
        redactionVersion: 1,
        requestedAt: completedAt,
        completedAt,
        result: event.isError ? undefined : event.result,
        error,
        artifactRefs: artifactRefs.length ? artifactRefs : undefined,
      });
      await this.publishToolCallUpdated(context, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.isError ? "error" : "completed",
        resultPreview: event.isError ? undefined : event.result,
        error: error?.message,
        errorDetails: error,
        createdAt: completedAt,
        updatedAt: completedAt,
      });
      await this.events?.append({
        type: event.isError ? "tool.call.failed" : "tool.call.completed",
        durability: "durable",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data: {
          ...this.commonData,
          ...scopeData(context),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status,
          lifecycleSeq: 3,
          result: event.isError ? undefined : event.result,
          error,
          artifactRefs: artifactRefs.length ? artifactRefs : undefined,
          completedAt,
        },
      });
    }
  }

  private async handleLegacyAssistantDelta(
    context: HarnessRunContext,
    update: { type?: string; delta?: string },
  ): Promise<void> {
    if (update.type === "text_delta" || update.type === "thinking_delta") {
      await this.events?.append({
        type: "run.delta",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data: {
          ...this.commonData,
          ...scopeData(context),
          deltaId: `delta_${Date.now()}_${++this.deltaCounter}`,
          role: "assistant",
          text: bound(String(update.delta ?? "")),
        },
      });
    } else if (update.type === "text_end") {
      await this.events?.append({
        type: "run.delta",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data: {
          ...this.commonData,
          ...scopeData(context),
          deltaId: `delta_${Date.now()}_${++this.deltaCounter}`,
          role: "assistant",
          finishReason: "text_end",
        },
      });
    }
  }

  private async handleRichAssistantUpdate(
    context: HarnessRunContext,
    update: {
      type?: string;
      delta?: string;
      content?: string;
      contentIndex?: number;
      partial?: unknown;
      toolCall?: { id?: string; name?: string; arguments?: unknown };
    },
  ): Promise<void> {
    const live = this.liveRuns.get(context.runId);
    if (!live?.turnId || !live.liveMessageId) return;
    const contentIndex = update.contentIndex ?? 0;
    if (update.type === "text_delta" || update.type === "thinking_delta") {
      const data = this.conversationRuntime.applyContentDelta({
        runId: context.runId,
        turnId: live.turnId,
        liveMessageId: live.liveMessageId,
        contentIndex,
        kind: update.type === "thinking_delta" ? "thinking" : "text",
        delta: String(update.delta ?? ""),
      });
      await this.events?.append({
        type: "conversation.live.content.delta",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data,
      });
      return;
    }
    if (update.type === "text_end" || update.type === "thinking_end") {
      const kind = update.type === "thinking_end" ? "thinking" : "text";
      const data = this.conversationRuntime.finishContent({
        runId: context.runId,
        turnId: live.turnId,
        liveMessageId: live.liveMessageId,
        contentIndex,
        kind,
        finalText: update.content,
        redacted:
          kind === "thinking"
            ? assistantContentRedacted(update.partial, contentIndex)
            : undefined,
      });
      await this.events?.append({
        type: "conversation.live.content.done",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data,
      });
      return;
    }
    if (update.type === "toolcall_start") {
      const draft = assistantToolCallDraft(update.partial, contentIndex);
      const data = this.conversationRuntime.startToolDraft({
        runId: context.runId,
        turnId: live.turnId,
        liveMessageId: live.liveMessageId,
        contentIndex,
        providerToolCallId: draft?.id,
        toolName: draft?.name,
      });
      await this.events?.append({
        type: "conversation.live.tool_draft.started",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data,
      });
      return;
    }
    if (update.type === "toolcall_delta") {
      const draft = assistantToolCallDraft(update.partial, contentIndex);
      const data = this.conversationRuntime.applyToolDraftDelta({
        runId: context.runId,
        turnId: live.turnId,
        liveMessageId: live.liveMessageId,
        contentIndex,
        providerToolCallId: draft?.id,
        toolName: draft?.name,
        delta: String(update.delta ?? ""),
      });
      await this.events?.append({
        type: "conversation.live.tool_draft.delta",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data,
      });
      return;
    }
    if (update.type === "toolcall_end" && update.toolCall?.id) {
      const data = this.conversationRuntime.finishToolDraft({
        runId: context.runId,
        turnId: live.turnId,
        liveMessageId: live.liveMessageId,
        contentIndex,
        providerToolCallId: update.toolCall.id,
        toolName: update.toolCall.name ?? "tool",
        args: recordFromUnknown(update.toolCall.arguments),
      });
      await this.events?.append({
        type: "conversation.live.tool_draft.done",
        durability: "transient",
        conversationId: context.conversationId,
        agentId: context.agentId,
        runId: context.runId,
        data,
      });
    }
  }

  private async publishToolCallUpdated(
    context: HarnessRunContext,
    input: {
      toolCallId: string;
      toolName: string;
      status: ToolCallTranscriptRecord["status"];
      argsPreview?: unknown;
      resultPreview?: unknown;
      error?: string;
      errorDetails?: ToolCallTranscriptRecord["errorDetails"];
      createdAt: string;
      updatedAt: string;
    },
  ): Promise<void> {
    const parsedToolName = toolNameSchema.safeParse(input.toolName);
    if (!parsedToolName.success) return;
    const live = this.liveRuns.get(context.runId);
    const toolCall: ToolCallTranscriptRecord = {
      id: normalizeToolCallId(input.toolCallId),
      sourceToolCallId: input.toolCallId,
      providerToolCallId: input.toolCallId,
      conversationId: context.conversationId,
      agentId: context.agentId,
      projectId: this.projectId(),
      runId: context.runId,
      turnId: live?.turnId,
      liveMessageId: live?.liveMessageId,
      toolName: parsedToolName.data,
      risk: defaultToolRisk(parsedToolName.data),
      cwd: process.cwd(),
      status: input.status,
      error: input.error,
      errorDetails: input.errorDetails,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      argsPreview: input.argsPreview,
      resultPreview: input.resultPreview,
    };
    await this.events?.append({
      type: "conversation.tool_call.updated",
      durability: "durable",
      conversationId: context.conversationId,
      agentId: context.agentId,
      runId: context.runId,
      data: {
        conversationId: context.conversationId,
        agentId: context.agentId,
        projectId: this.projectId(),
        runId: context.runId,
        turnId: live?.turnId,
        liveMessageId: live?.liveMessageId,
        providerToolCallId: input.toolCallId,
        toolCall,
      },
    });
  }

  private projectId(): string {
    const sandboxId =
      typeof this.commonData.sandboxId === "string"
        ? this.commonData.sandboxId
        : undefined;
    const instanceId =
      typeof this.commonData.instanceId === "string"
        ? this.commonData.instanceId
        : "local";
    return `proj_sandbox_${sandboxSha256Digest(sandboxId ?? instanceId).slice(7, 23)}`;
  }

  private async boundedTranscriptContent(
    context: HarnessRunContext,
    nameHint: string,
    text: string,
  ) {
    return this.artifacts
      ? this.artifacts.boundedTextOrArtifact(context, nameHint, text)
      : { content: boundedText(text) };
  }

  private async toolArtifactRefs(context: HarnessRunContext, result: unknown) {
    const text = toolUpdateText(result);
    if (!this.artifacts || text.length <= 64_000) return [];
    const artifact = await this.artifacts.writeTextArtifact(
      context,
      `tool-result-${Date.now()}`,
      text,
      "text/plain; charset=utf-8",
    );
    return [artifact];
  }
}

function scopeData(scope: {
  conversationId: string;
  agentId: string;
  runId: string;
}) {
  return {
    conversationId: scope.conversationId,
    agentId: scope.agentId,
    runId: scope.runId,
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function assistantContentRedacted(
  message: unknown,
  contentIndex: number,
): boolean | undefined {
  const content = (message as { content?: unknown[] } | undefined)?.content;
  const block = content?.[contentIndex] as
    | { type?: string; redacted?: boolean }
    | undefined;
  return block?.type === "thinking" ? block.redacted : undefined;
}

function assistantToolCallDraft(
  message: unknown,
  contentIndex: number,
): { id?: string; name?: string } | undefined {
  const content = (message as { content?: unknown[] } | undefined)?.content;
  const block = content?.[contentIndex] as
    | { type?: string; id?: string; name?: string }
    | undefined;
  return block?.type === "toolCall"
    ? { id: block.id, name: block.name }
    : undefined;
}

function normalizeToolCallId(toolCallId: string): string {
  if (toolCallId.startsWith("tool_")) return toolCallId;
  return `tool_${sandboxSha256Digest(toolCallId).slice(7, 23)}`;
}

function defaultToolRisk(toolName: string): ToolCallTranscriptRecord["risk"] {
  if (toolName === "bash" || toolName === "python") return "command";
  if (toolName === "edit" || toolName === "write") return "workspace_write";
  if (
    toolName.startsWith("web_") ||
    toolName.includes("jira") ||
    toolName.includes("confluence")
  )
    return "network";
  if (toolName === "ask_user") return "interaction";
  if (toolName === "explore") return "agent_spawn";
  if (toolName.startsWith("task_")) return "command";
  return "read";
}

function messageText(message: { content?: unknown }): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((block) => {
        const value = block as { type?: string; text?: string };
        return value.type === "text" || value.type === "thinking"
          ? (value.text ?? "")
          : "";
      })
      .filter(Boolean)
      .join("\n");
  return "";
}

function toolUpdateText(value: unknown): string {
  const result = value as AgentToolResult<unknown> | undefined;
  if (result?.content && Array.isArray(result.content)) {
    return result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "string") return value;
  return "";
}

function bound(text: string, max = 16_000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function boundedText(text: string): {
  text: string;
  truncated?: boolean;
  bytes?: number;
} {
  const bytes = Buffer.byteLength(text);
  const truncated = text.length > 64_000;
  return {
    text: bound(text, 64_000),
    truncated: truncated || undefined,
    bytes,
  };
}
