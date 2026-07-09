import {
  buildConversationRenderProjection,
  type ConversationRenderProjection,
  type ConversationRenderState,
} from "@nervekit/shared-ui/state";

export type SandboxChatRender = ConversationRenderProjection;

/** @deprecated Use buildConversationRenderProjection from @nervekit/shared-ui. */
export function buildSandboxChatRender(
  state: ConversationRenderState | undefined,
): SandboxChatRender {
  return buildConversationRenderProjection(state);
}
