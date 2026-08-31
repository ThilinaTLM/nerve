import type { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";
import { toolSlotKey } from "./active-run.js";

export function toolCallAliasIds(toolCall: ToolCallTranscriptRecord): string[] {
  return Array.from(
    new Set(
      [toolCall.sourceToolCallId, toolCall.providerToolCallId].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

export function toolCallSlotKey(
  toolCall: ToolCallTranscriptRecord,
): string | undefined {
  return toolCall.liveMessageId && typeof toolCall.contentIndex === "number"
    ? toolSlotKey(toolCall.liveMessageId, toolCall.contentIndex)
    : undefined;
}

export function isLiveToolCall(toolCall: ToolCallTranscriptRecord): boolean {
  return (
    toolCall.status === "committed" ||
    toolCall.status === "waiting" ||
    toolCall.status === "running"
  );
}

/** Deterministic creation-time ordering shared by both timeline passes. */
export function byCreatedAtAscending(
  a: ToolCallTranscriptRecord,
  b: ToolCallTranscriptRecord,
): number {
  const cmp = a.createdAt.localeCompare(b.createdAt);
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
}

/**
 * Stable timeline key for a tool record: content-slot identity when the
 * record carries live coordinates (survives materialization), durable tool id
 * for genuinely unanchored/non-run tools.
 */
export function toolTimelineKey(toolCall: ToolCallTranscriptRecord): string {
  return toolCallSlotKey(toolCall) ?? `tool:${toolCall.id}`;
}

/**
 * Tracks rendered logical calls across durable-id, slot, and same-run provider
 * identities. The latter two cover approval/resume alias records.
 */
export function createToolConsumptionTracker(input: {
  initiallyConsumedIds: ReadonlySet<string>;
  toolCallsById: ReadonlyMap<string, ToolCallTranscriptRecord>;
  activeRunId?: string;
}) {
  const consumedIds = new Set(input.initiallyConsumedIds);
  const consumedSlots = new Set<string>();
  const consumedRunAliases = new Set<string>();

  const runAliasKeys = (
    toolCall: ToolCallTranscriptRecord,
    extraAlias?: string,
  ): string[] => {
    // Only a live draft alias may inherit the active run. A committed record
    // without a run id must not suppress an unrelated call in the active run.
    const runId =
      toolCall.runId ?? (extraAlias ? input.activeRunId : undefined);
    if (!runId) return [];
    const aliases = new Set([
      ...toolCallAliasIds(toolCall),
      ...(extraAlias ? [extraAlias] : []),
    ]);
    return [...aliases].map(
      (alias) => `${runId}:${toolCall.toolName}:${alias}`,
    );
  };

  const consume = (toolCall: ToolCallTranscriptRecord, extraAlias?: string) => {
    consumedIds.add(toolCall.id);
    const slotKey = toolCallSlotKey(toolCall);
    if (slotKey) consumedSlots.add(slotKey);
    for (const aliasKey of runAliasKeys(toolCall, extraAlias)) {
      consumedRunAliases.add(aliasKey);
    }
  };

  for (const toolCallId of input.initiallyConsumedIds) {
    const toolCall = input.toolCallsById.get(toolCallId);
    if (toolCall) consume(toolCall);
  }

  return {
    consume,
    isConsumed(toolCall: ToolCallTranscriptRecord): boolean {
      if (consumedIds.has(toolCall.id)) return true;
      const slotKey = toolCallSlotKey(toolCall);
      if (slotKey && consumedSlots.has(slotKey)) return true;
      return runAliasKeys(toolCall).some((aliasKey) =>
        consumedRunAliases.has(aliasKey),
      );
    },
  };
}
