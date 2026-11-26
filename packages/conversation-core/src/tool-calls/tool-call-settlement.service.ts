import { toolDefinitionByName } from "@nervekit/tools/catalog";
import { createId } from "@nervekit/contracts";
import { singleFlight } from "@nervekit/primitives";
import type { ToolCall, ToolCallOutcome } from "@nervekit/contracts/core";
import type { ToolExecutionResultPayload } from "@nervekit/contracts/tools";
import type { ToolCallServiceOptions } from "./tool-call-types.js";
import { planImplementationInput } from "./plan-review-result.js";
import { prepareToolResult } from "./tool-result.service.js";

export class ToolCallSettlement {
  private readonly settlements = new Map<string, Promise<void>>();
  private readonly barriers = new Map<string, Set<() => void>>();
  private closed = false;
  private readonly executionStarts = new Map<string, string>();

  recordExecutionStart(call: ToolCall): void {
    if (call.state === "running")
      this.executionStarts.set(call.id, call.updatedAt);
  }
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
    await singleFlight(this.settlements, call.id, () =>
      this.persistSettlement(call, outcome, result, claim),
    );
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
    const core = this.options.coreTools.get(call.toolName)?.definition;
    // An installed extension's tool is the one of the call's project, not another project's.
    let scope: string | undefined;
    if (!core)
      try {
        scope = (await this.options.context(call.conversationId)).projectDir;
      } catch {
        // No project context: only the global catalog applies.
      }
    const prepared = await prepareToolResult(
      this.options.assets,
      current,
      outcome,
      result,
      core ?? toolDefinitionByName(call.toolName, scope),
    );
    if (this.closed) return;
    let afterAcceptance: (() => void) | undefined;
    const event = this.options.storage.transaction(() => {
      const row = this.options.storage.toolCalls.get(call.id);
      if (
        !row ||
        (claim !== null && row.executionClaim !== claim) ||
        (row.state === "running" && row.executionClaim !== claim)
      )
        return null;
      const input =
        outcome === "completed" ? planImplementationInput(row) : undefined;
      if (input) {
        if (!this.options.inputs)
          throw new Error("Plan implementation queue is not configured");
        afterAcceptance =
          this.options.inputs.acceptSubmission(input).afterCommit;
      }
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
          startedAt:
            this.executionStarts.get(row.id) ??
            (row.state === "running" ? row.updatedAt : undefined),
          agentProjection: prepared.agentProjection,
          agentProjectionSnapshot: prepared.agentProjectionSnapshot,
          userProjection: prepared.userProjection,
          supervision: row.supervision,
          interactionResolution: row.interaction?.resolution ?? null,
          resolutionRequestId: row.interaction?.resolutionRequestId ?? null,
          assetIds,
        },
      });
      this.options.assets.linkToEvent(assetIds, event.id);
      this.options.storage.toolCalls.delete(row.id);
      return event;
    });
    if (!event) return;
    afterAcceptance?.();
    this.options.onSettled?.(call.conversationId);
    this.executionStarts.delete(call.id);
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
