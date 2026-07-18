import type {
  AgentHarnessEvent,
  AgentMessage,
} from "@nervekit/host-runtime/harness";
import {
  ConversationRuntime,
  type ConversationEventType,
  type ConversationLiveMessageStartedData,
} from "@nervekit/contracts";

export type SandboxLiveConversationScope = {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
};

export type MaterializedAssistantMessage = Pick<
  ConversationLiveMessageStartedData,
  "turnId" | "liveMessageId" | "messageOrdinal"
>;

type MessageUpdateEvent = Extract<
  AgentHarnessEvent,
  { type: "message_update" }
>;

type PublishLiveEvent = (
  type: ConversationEventType,
  data: Readonly<Record<string, unknown>>,
) => void;

const NON_STREAMING_TOOL_DRAFTS = new Set(["write", "edit"]);

/**
 * Projects low-level harness streaming events onto the transport-neutral
 * conversation event contract consumed by both workbench chat surfaces.
 */
export class SandboxConversationLiveProjector {
  private readonly runtime = new ConversationRuntime();
  private currentTurnId: string | undefined;
  private currentMessage: ConversationLiveMessageStartedData | undefined;
  private readonly toolNamesByContentIndex = new Map<number, string>();

  constructor(
    private readonly scope: SandboxLiveConversationScope,
    private readonly publish: PublishLiveEvent,
  ) {
    this.runtime.startRun(scope);
  }

  startTurn(): void {
    const turn = this.runtime.startTurn(this.scope.runId);
    this.currentTurnId = turn.turnId;
    this.currentMessage = undefined;
    this.toolNamesByContentIndex.clear();
    this.emit("conversation.live.turn.started", {
      ...this.scope,
      turnId: turn.turnId,
      ordinal: turn.ordinal,
    });
  }

  startAssistantMessage(): void {
    if (!this.currentTurnId) this.startTurn();
    const started = this.runtime.startAssistantMessage(
      this.scope.runId,
      this.currentTurnId!,
    );
    this.currentMessage = started;
    this.toolNamesByContentIndex.clear();
    this.emit("conversation.live.message.started", started);
  }

  finishAssistantMessage(failed = false): void {
    if (!this.currentTurnId || !this.currentMessage) return;
    const coordinates = [
      this.scope.runId,
      this.currentTurnId,
      this.currentMessage.liveMessageId,
    ] as const;
    if (failed) this.runtime.failAssistantMessage(...coordinates);
    else this.runtime.completeAssistantMessage(...coordinates);
  }

  finishTurn(failed = false): void {
    if (!this.currentTurnId) return;
    if (failed) this.runtime.failTurn(this.scope.runId, this.currentTurnId);
    else this.runtime.completeTurn(this.scope.runId, this.currentTurnId);
    this.currentTurnId = undefined;
    this.currentMessage = undefined;
    this.toolNamesByContentIndex.clear();
  }

  updateAssistantMessage(event: MessageUpdateEvent): void {
    if (!this.currentTurnId || !this.currentMessage) return;
    const update = event.assistantMessageEvent;
    const coordinates = (contentIndex: number) => ({
      runId: this.scope.runId,
      turnId: this.currentTurnId!,
      liveMessageId: this.currentMessage!.liveMessageId,
      contentIndex,
    });

    switch (update.type) {
      case "text_delta":
      case "thinking_delta":
        this.emit(
          "conversation.live.content.delta",
          this.runtime.applyContentDelta({
            ...coordinates(update.contentIndex),
            kind: update.type === "text_delta" ? "text" : "thinking",
            delta: update.delta,
          }),
        );
        return;
      case "text_end":
      case "thinking_end":
        this.emit(
          "conversation.live.content.done",
          this.runtime.finishContent({
            ...coordinates(update.contentIndex),
            kind: update.type === "text_end" ? "text" : "thinking",
            finalText: update.content,
            redacted:
              update.type === "thinking_end"
                ? assistantContentRedacted(update.partial, update.contentIndex)
                : undefined,
          }),
        );
        return;
      case "toolcall_start": {
        const draft = assistantToolCallDraft(
          update.partial,
          update.contentIndex,
        );
        if (draft?.name)
          this.toolNamesByContentIndex.set(update.contentIndex, draft.name);
        this.emit(
          "conversation.live.tool_draft.started",
          this.runtime.startToolDraft({
            ...coordinates(update.contentIndex),
            providerToolCallId: draft?.id,
            toolName: draft?.name,
          }),
        );
        return;
      }
      case "toolcall_delta": {
        const draft = assistantToolCallDraft(
          update.partial,
          update.contentIndex,
        );
        const toolName =
          draft?.name ?? this.toolNamesByContentIndex.get(update.contentIndex);
        if (draft?.name)
          this.toolNamesByContentIndex.set(update.contentIndex, draft.name);
        // Match workbench behavior: write/edit arguments can be very large and
        // are represented by their live card rather than retaining full JSON.
        if (toolName && NON_STREAMING_TOOL_DRAFTS.has(toolName)) return;
        this.emit(
          "conversation.live.tool_draft.delta",
          this.runtime.applyToolDraftDelta({
            ...coordinates(update.contentIndex),
            providerToolCallId: draft?.id,
            toolName,
            delta: update.delta,
          }),
        );
        return;
      }
      case "toolcall_end":
        this.toolNamesByContentIndex.delete(update.contentIndex);
        this.emit(
          "conversation.live.tool_draft.done",
          this.runtime.finishToolDraft({
            ...coordinates(update.contentIndex),
            providerToolCallId: update.toolCall.id,
            toolName: update.toolCall.name,
            args: recordFromUnknown(update.toolCall.arguments),
          }),
        );
        return;
    }
  }

  publishToolOutput(
    providerToolCallId: string,
    toolCallId: string,
    toolName: string,
    partialResult: unknown,
  ): void {
    const result = recordFromUnknown(partialResult);
    const details = recordFromUnknown(result.details);
    const delta =
      typeof details.chunk === "string"
        ? details.chunk
        : textContentFromToolResult(result.content);
    if (!delta) return;
    const anchor = this.resolveToolAnchor(providerToolCallId);
    const stream =
      details.stream === "stdout" || details.stream === "stderr"
        ? details.stream
        : "combined";
    this.emit(
      "conversation.live.tool_output.delta",
      this.runtime.applyToolOutputDelta({
        conversationId: this.scope.conversationId,
        agentId: this.scope.agentId,
        projectId: this.scope.projectId,
        runId: this.scope.runId,
        turnId: anchor?.turnId,
        liveMessageId: anchor?.liveMessageId,
        contentIndex: anchor?.contentIndex,
        providerToolCallId,
        toolCallId,
        toolName,
        stream,
        delta,
      }),
    );
  }

  materializeAssistantMessage(): MaterializedAssistantMessage | undefined {
    if (!this.currentTurnId || !this.currentMessage) return undefined;
    const message = this.currentMessage;
    this.runtime.markMessageMaterialized(
      this.scope.runId,
      this.currentTurnId,
      message.liveMessageId,
    );
    this.currentMessage = undefined;
    return {
      turnId: message.turnId,
      liveMessageId: message.liveMessageId,
      messageOrdinal: message.messageOrdinal,
    };
  }

  resolveToolAnchor(providerToolCallId: string) {
    return this.runtime.resolveToolAnchor(this.scope.runId, providerToolCallId);
  }

  private emit(type: ConversationEventType, data: object): void {
    this.publish(type, { ...data });
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textContentFromToolResult(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const record = recordFromUnknown(part);
      return record.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("");
}

function assistantContentRedacted(
  message: AgentMessage,
  contentIndex: number,
): boolean | undefined {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const block = content[contentIndex];
  if (!block || typeof block !== "object") return undefined;
  const record = block as Record<string, unknown>;
  return record.type === "thinking" && typeof record.redacted === "boolean"
    ? record.redacted
    : undefined;
}

function assistantToolCallDraft(
  message: AgentMessage,
  contentIndex: number,
): { id?: string; name?: string } | undefined {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const block = content[contentIndex];
  if (!block || typeof block !== "object") return undefined;
  const record = block as Record<string, unknown>;
  if (record.type !== "toolCall") return undefined;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
  };
}
