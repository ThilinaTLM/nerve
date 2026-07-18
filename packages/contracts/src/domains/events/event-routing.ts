import { publicEventDefinition } from "./public-event-catalog.schema.js";

export const WORKSPACE_STREAM = "workspace";
const CONVERSATION_STREAM_PREFIX = "conv/";

export const conversationStream = (conversationId: string): string => {
  if (!conversationId) throw new Error("conversationId must not be empty");
  return `${CONVERSATION_STREAM_PREFIX}${conversationId}`;
};

export function parseConversationStream(stream: string): string | null {
  if (!stream.startsWith(CONVERSATION_STREAM_PREFIX)) return null;
  const conversationId = stream.slice(CONVERSATION_STREAM_PREFIX.length);
  return conversationId.length > 0 ? conversationId : null;
}

const workspaceConversationEvents = new Set([
  "conversation.created",
  "conversation.updated",
  "conversation.deleted",
  "conversation.imported",
]);

/**
 * Routes catalog-backed sequenced events to their authoritative durable log.
 * Ephemeral events intentionally have no stream and must use event.notify.
 */
export function streamForEvent(type: string, payload: unknown): string {
  const definition = publicEventDefinition(type);
  if (!definition) throw new Error(`Unknown public event: ${type}`);
  if (definition.delivery !== "sequenced") {
    throw new Error(`Ephemeral event ${type} does not have a stream`);
  }
  if (workspaceConversationEvents.has(type)) return WORKSPACE_STREAM;

  if (isRecord(payload) && typeof payload.conversationId === "string") {
    return conversationStream(payload.conversationId);
  }
  return WORKSPACE_STREAM;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
