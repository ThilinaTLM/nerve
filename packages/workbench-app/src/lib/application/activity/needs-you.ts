import type { ConversationSummary } from "@nervekit/contracts/core";
import type { NeedsYouInput } from "$lib/presentation/activity/notifications";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import { buildMobileInbox } from "$lib/presentation/shell/mobile/mobile-inbox";

/**
 * Conversations waiting on the user, from the same derivation the mobile inbox
 * uses. Agent errors share that list but are not a request for input.
 */
export function deriveNeedsYou(input: {
  conversations: readonly ConversationSummary[];
  activityById: Readonly<Record<string, ConversationActivity>>;
  projectNameById: Readonly<Record<string, string>>;
}): NeedsYouInput[] {
  const byId = new Map(input.conversations.map((entry) => [entry.id, entry]));
  return buildMobileInbox({
    conversations: input.conversations,
    activityById: input.activityById,
  })
    .needsYou.filter((item) => item.kind !== "error")
    .map((item) => {
      const conversation = byId.get(item.conversationId);
      return {
        id: item.id,
        conversationId: item.conversationId,
        conversationTitle: item.title,
        projectId: conversation?.projectId,
        projectName: conversation
          ? input.projectNameById[conversation.projectId]
          : undefined,
        at: item.at ?? conversation?.updatedAt ?? "",
      };
    });
}
