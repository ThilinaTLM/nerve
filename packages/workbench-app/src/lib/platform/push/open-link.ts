/**
 * Deep links into a conversation: `/?open=<conversationId>` from a cold
 * notification tap, and a service-worker message when the app is open.
 */

export const OPEN_CONVERSATION_MESSAGE = "nerve.open-conversation";

export type OpenConversationMessage = {
  type: typeof OPEN_CONVERSATION_MESSAGE;
  conversationId: string;
};

export function openConversationUrl(conversationId: string): string {
  return `/?open=${encodeURIComponent(conversationId)}`;
}

export function parseOpenConversationMessage(
  data: unknown,
): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const message = data as Partial<OpenConversationMessage>;
  return message.type === OPEN_CONVERSATION_MESSAGE &&
    typeof message.conversationId === "string" &&
    message.conversationId
    ? message.conversationId
    : undefined;
}

/**
 * Reads `?open=` and returns the conversation plus the same location without
 * the parameter (path, other params and hash kept).
 */
export function takeOpenLink(
  location: Pick<Location, "pathname" | "search" | "hash">,
): { conversationId: string; cleanUrl: string } | undefined {
  const params = new URLSearchParams(location.search);
  const conversationId = params.get("open");
  if (!conversationId) return undefined;
  params.delete("open");
  const search = params.toString();
  return {
    conversationId,
    cleanUrl: `${location.pathname}${search ? `?${search}` : ""}${location.hash}`,
  };
}
