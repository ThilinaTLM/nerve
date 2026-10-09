import { createId } from "@nervekit/contracts";
import type { ToolCall, ToolCallOutcome } from "@nervekit/contracts/core";
import type { ToolExecutionResultPayload } from "@nervekit/contracts/tools";
import type { ToolCallServiceOptions } from "./tool-call.service.js";
import { prepareToolResult } from "./tool-result.service.js";

export class ToolCallSettlement {
  private readonly settlements = new Map<string, Promise<void>>();
  private readonly barriers = new Map<string, Set<() => void>>();
  private closed = false;
  constructor(private readonly options: ToolCallServiceOptions) {}
  waitForTurn(conversationId: string, turnId: string): Promise<void> {
    if (
      !this.options.storage.toolCalls.listByTurn(conversationId, turnId).length
    )
      return Promise.resolve();
    const key = `${conversationId}/${turnId}`;
    return new Promise((resolve) => {
      const waiters = this.barriers.get(key) ?? new Set<() => void>();
      waiters.add(resolve);
      this.barriers.set(key, waiters);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    // Drain managed payload I/O before storage closes, but never commit a response.
    await Promise.allSettled(this.settlements.values());
  }

  async settle(
    call: ToolCall,
    outcome: ToolCallOutcome,
    result: ToolExecutionResultPayload,
    claim: string | null = null,
  ): Promise<void> {
    if (this.closed) return;
    const active = this.settlements.get(call.id);
    if (active) return active;
    const task = this.persistSettlement(call, outcome, result, claim);
    this.settlements.set(call.id, task);
    try {
      await task;
    } finally {
      this.settlements.delete(call.id);
    }
  }

  private async persistSettlement(
    call: ToolCall,
    outcome: ToolCallOutcome,
    result: ToolExecutionResultPayload,
    claim: string | null,
  ): Promise<void> {
    const current = this.options.storage.toolCalls.get(call.id);
    if (
      !current ||
      (claim !== null && current.executionClaim !== claim) ||
      (current.state === "running" && current.executionClaim !== claim)
    )
      return;
    const prepared = await prepareToolResult(
      this.options.assets,
      current,
      outcome,
      result,
      this.options.coreTools.get(call.toolName)?.definition,
    );
    if (this.closed) return;
    const event = this.options.storage.transaction(() => {
      const row = this.options.storage.toolCalls.get(call.id);
      if (
        !row ||
        (claim !== null && row.executionClaim !== claim) ||
        (row.state === "running" && row.executionClaim !== claim)
      )
        return null;
      const assetIds = [
        ...new Set([
          ...prepared.assetIds,
          ...this.options.storage.assets
            .list(call.conversationId)
            .filter(
              (asset) =>
                asset.toolCallId === call.id &&
                asset.eventId === null &&
                asset.asyncBashId === null,
            )
            .map((asset) => asset.id),
        ]),
      ];
      const event = this.options.storage.events.append({
        id: createId("evt"),
        conversationId: row.conversationId,
        turnId: row.turnId,
        inputId:
          row.origin === "user" && typeof row.arguments.inputId === "string"
            ? row.arguments.inputId
            : null,
        type: "tool_call_response",
        llmRepresentation:
          row.origin === "model"
            ? "tool_result"
            : row.arguments.includeInContext === false
              ? "none"
              : "user",
        createdAt: new Date().toISOString(),
        payload: {
          toolCallId: row.id,
          providerCallId: row.providerCallId,
          toolName: row.toolName,
          arguments:
            row.origin === "user"
              ? {
                  command: row.arguments.command ?? "",
                  ...(typeof row.arguments.originalText === "string"
                    ? { originalText: row.arguments.originalText }
                    : {}),
                }
              : row.arguments,
          origin: row.origin,
          assistantEventId: row.assistantEventId,
          contentIndex: row.contentIndex,
          outcome,
          result: prepared.result,
          modelContent: prepared.modelContent,
          supervision: row.supervision,
          interactionResolution: row.interaction?.resolution ?? null,
          resolutionRequestId: row.interaction?.resolutionRequestId ?? null,
          assetIds,
        },
      });
      this.options.assets.linkToEvent(assetIds, event.id);
      this.options.storage.toolCalls.delete(row.id);
      this.options.onSettled?.(row.conversationId);
      return event;
    });
    if (!event) return;
    this.options.emit({
      kind: "event_appended",
      conversationId: call.conversationId,
      event,
    });
    this.options.emit({
      kind: "tool_call_changed",
      conversationId: call.conversationId,
      toolCall: { id: call.id, removed: true },
    });
    if (
      !this.options.storage.toolCalls.listByTurn(
        call.conversationId,
        call.turnId,
      ).length
    ) {
      const key = `${call.conversationId}/${call.turnId}`;
      for (const resolve of this.barriers.get(key) ?? []) resolve();
      this.barriers.delete(key);
    }
  }
}
