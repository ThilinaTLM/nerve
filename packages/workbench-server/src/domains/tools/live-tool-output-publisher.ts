import {
  splitLiveOutputChunks,
  type ToolExecutionOutputUpdate,
} from "@nervekit/tools";
import type { ConversationRuntime, ToolCallRecord } from "@nervekit/contracts";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";

/** Owns validated, ordered publication of transient tool output. */
export class LiveToolOutputPublisher {
  readonly #tails = new Map<string, Promise<void>>();

  constructor(
    private readonly events: StreamLogRegistry,
    private readonly runtime: ConversationRuntime,
    private readonly logger?: ApplicationLogger,
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
      try {
        await this.events.publish("conversation.live.tool_output.delta", data);
        this.runtime.applyToolOutputDelta(input);
      } catch (error) {
        await this.reportFailure(toolCall, error);
      }
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

  private async reportFailure(
    toolCall: ToolCallRecord,
    error: unknown,
  ): Promise<void> {
    await this.logger
      ?.warn("Live tool output publication failed", {
        projectId: toolCall.projectId,
        conversationId: toolCall.conversationId,
        agentId: toolCall.agentId,
        runId: toolCall.runId,
        toolCallId: toolCall.id,
        context: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      .catch(() => undefined);
  }
}
