import { conversationEventTypes } from "@nervekit/contracts";

const conversationUiEventTypes = new Set<string>(conversationEventTypes);

/** Events understood by the shared ConversationRenderState reducer. */
export function isSandboxConversationUiEvent(type: string): boolean {
  return conversationUiEventTypes.has(type);
}
