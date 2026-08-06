import {
  splitLiveOutputChunks,
  type ToolExecutionOutputUpdate,
} from "@nervekit/tools";
import type { ToolCallRecord } from "@nervekit/contracts";
import type { ConversationRuntime } from "../runs/runtime/conversation-runtime.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";

/** Owns validated, ordered publication of transient tool output. */
export class LiveToolOutputPublisher {
  readonly #tails = new Map<string, Promise<void>>();

  constructor(
    private readonly events: StreamLogRegistry,
    private readonly runtime: ConversationRuntime,
  ) {}

  async publish(
    toolCall: ToolCallRecord,
    update: ToolExecutionOutputUpdate,
    runId?: string,
  ): Promise<void> {
    if (update.kind !== "output" || update.chunk.length === 0) return;
    for (const delta of splitLiveOutputChunks(update.chunk)) {
      const outputRunId = runId ?? toolCall.runId;
      const input = {
        agentId: toolCall.agentId,
        runId: outputRunId,
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
        delta,
      };
      const data = {
        ...input,
        offset: this.runtime.toolOutputOffset(outputRunId, toolCall.id),
      };
      this.events.publishBestEffort(
        "conversation.live.tool_output.delta",
        data,
        "conversation.live.tool_output.delta",
      );
      this.runtime.applyToolOutputDelta(input);
    }
  }

  enqueue(
    toolCall: ToolCallRecord,
    update: ToolExecutionOutputUpdate,
    runId?: string,
  ): void {
    const previous = this.#tails.get(toolCall.id) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(() => this.publish(toolCall, update, runId));
    const tail = pending.catch(() => undefined);
    this.#tails.set(toolCall.id, tail);
    void tail.finally(() => {
      if (this.#tails.get(toolCall.id) === tail)
        this.#tails.delete(toolCall.id);
    });
  }

  async drain(toolCallId: string): Promise<void> {
    await this.#tails.get(toolCallId);
  }
}
