import {
  buildConversationRenderProjection,
  type ConversationRenderProjection,
  type ConversationRenderState,
} from "@nervekit/conversation-ui/state";

export type SandboxChatRender = ConversationRenderProjection;

/** @deprecated Use buildConversationRenderProjection from conversation-ui. */
export function buildSandboxChatRender(
  state: ConversationRenderState | undefined,
): SandboxChatRender {
  return buildConversationRenderProjection(state);
}
