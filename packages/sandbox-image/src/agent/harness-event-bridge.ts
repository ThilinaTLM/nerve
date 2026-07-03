import type {
  AgentHarness,
  AgentHarnessEvent,
  AgentToolResult,
} from "@nervekit/agent";
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

export class HarnessEventBridge {
  private deltaCounter = 0;
  private transcriptIndex = 1;
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
      };
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
        await this.runs?.appendTranscriptEntry(context, {
          entryId: `entry_${Date.now()}_${this.transcriptIndex}`,
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
