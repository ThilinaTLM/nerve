import { createHash } from "node:crypto";
import { ApplicationError } from "../../core/application-error.js";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  ConversationEntry,
  ConversationJournalEvent,
  ApprovalSettlement,
} from "@nervekit/contracts/conversations";
import type { ConversationJournalState } from "../conversations/conversation-journal.repository.js";
import { toolCallResultForModel } from "../tools/orchestration/agent-tool-adapter.js";
import { agentMessageText } from "../agents/execution/index.js";

/** Prepare history and model context together; never append one without the other. */
export function prepareApprovalTranscript(
  state: ConversationJournalState,
  settlement: ApprovalSettlement,
): { entries: ConversationEntry[]; events: ConversationJournalEvent[] } {
  const entries: ConversationEntry[] = [];
  const events: ConversationJournalEvent[] = [];
  let parentId = state.conversation?.activeEntryId;
  let modelParentId = state.modelLeafId;
  let missingSeen = false;
  for (const toolId of settlement.toolCallIds) {
    const tool = state.toolCalls.get(toolId);
    if (
      !tool ||
      !["completed", "failed", "denied", "cancelled"].includes(tool.status)
    ) {
      throw new Error("Approval transcript requires terminal batch members.");
    }
    const existing = state.entries.find(
      (entry) =>
        (entry.details as { toolRecordId?: string } | undefined)
          ?.toolRecordId === toolId,
    );
    if (existing) {
      if (missingSeen || !state.modelEntryById.has(existing.id)) {
        throw new ApplicationError(
          409,
          "RUN_CHECKPOINT_STALE",
          "An earlier tool result has incomplete or out-of-order model/history context. No tool will be repeated.",
        );
      }
      entries.push(existing);
      continue;
    }
    missingSeen = true;
    const providerId =
      tool.providerToolCallId ?? tool.sourceToolCallId ?? tool.id;
    if (
      state.modelEntries.some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "toolResult" &&
          entry.message.toolCallId === providerId,
      )
    ) {
      throw new ApplicationError(
        409,
        "RUN_CHECKPOINT_STALE",
        "An earlier tool result has model context but no matching history entry. No tool will be repeated.",
      );
    }
    const result = toolCallResultForModel(tool);
    const timestamp = tool.settledAt ?? tool.updatedAt;
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: tool.providerToolCallId ?? tool.sourceToolCallId ?? tool.id,
      toolName: tool.toolName,
      content: result.content,
      details: result.details,
      isError: tool.status !== "completed",
      timestamp: Date.parse(timestamp),
    };
    const id = `entry_${createHash("sha256").update(`tool-result:${tool.id}`).digest("hex").slice(0, 32)}`;
    const entry: ConversationEntry = {
      id,
      conversationId: tool.conversationId,
      agentId: tool.agentId,
      runId: tool.runId,
      turnId: tool.turnId,
      parentEntryId: parentId,
      role: "system",
      kind: "message",
      text: agentMessageText(message),
      details: {
        toolRecordId: tool.id,
        toolCallId: message.toolCallId,
        toolName: tool.toolName,
        isError: message.isError,
        details: message.details,
      },
      createdAt: timestamp,
    };
    events.push({
      kind: "model_context.entry_appended",
      conversationId: tool.conversationId,
      entry: JSON.parse(
        JSON.stringify({
          type: "message",
          id,
          parentId: modelParentId,
          timestamp,
          message,
        }),
      ),
    });
    events.push({
      kind: "conversation.entry_appended",
      conversationId: tool.conversationId,
      entry,
    });
    entries.push(entry);
    parentId = id;
    modelParentId = id;
  }
  if (state.conversation && parentId !== state.conversation.activeEntryId) {
    events.push({
      kind: "conversation.upserted",
      conversationId: state.conversationId,
      conversation: {
        ...state.conversation,
        activeEntryId: parentId,
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return { entries, events };
}
