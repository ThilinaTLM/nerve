import type { EventDurability } from "../events/index.js";
import type { ToolCallTranscriptRecord } from "../tools/index.js";
import type {
  ConversationEventType,
  ConversationToolCallUpdatedData,
} from "./conversation.schema.js";

export interface ConversationEventScope {
  conversationId: string;
  agentId?: string;
  projectId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
}

export interface ConversationEventPayload<T extends Record<string, unknown>> {
  type: ConversationEventType;
  durability: EventDurability;
  data: T;
}

export function conversationScopeData(scope: ConversationEventScope) {
  return {
    conversationId: scope.conversationId,
    agentId: scope.agentId,
    projectId: scope.projectId,
    runId: scope.runId,
    turnId: scope.turnId,
    liveMessageId: scope.liveMessageId,
  };
}

export function conversationEvent<T extends Record<string, unknown>>(input: {
  type: ConversationEventType;
  data: T;
  durability?: EventDurability;
}): ConversationEventPayload<T> {
  return {
    type: input.type,
    durability:
      input.durability ?? defaultConversationEventDurability(input.type),
    data: input.data,
  };
}

export function defaultConversationEventDurability(
  type: ConversationEventType,
): EventDurability {
  return type.startsWith("conversation.live.") ? "transient" : "durable";
}

export function conversationToolCallUpdatedData(input: {
  scope: Required<
    Pick<ConversationEventScope, "conversationId" | "agentId" | "projectId">
  > &
    Omit<ConversationEventScope, "conversationId" | "agentId" | "projectId">;
  toolCall: ToolCallTranscriptRecord;
  contentIndex?: number;
  providerToolCallId?: string;
}): ConversationToolCallUpdatedData {
  return {
    conversationId: input.scope.conversationId,
    agentId: input.scope.agentId,
    projectId: input.scope.projectId,
    runId: input.scope.runId,
    turnId: input.scope.turnId,
    liveMessageId: input.scope.liveMessageId,
    contentIndex: input.contentIndex,
    providerToolCallId: input.providerToolCallId,
    toolCall: input.toolCall,
  };
}
