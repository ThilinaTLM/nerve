import type { ConversationSummary } from "@nervekit/contracts/core";
import type { NeedsYouInput } from "$lib/presentation/activity/notifications";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import { buildMobileInbox } from "$lib/presentation/shell/mobile/mobile-inbox";

/**
 * Root conversations that need the user (input, failure, interruption) or hold
 * an unseen finished result, from the same derivation the mobile inbox uses.
 * Sub-agent requests surface through their root's pending input.
 */
export function deriveNeedsYou(input: {
  conversations: readonly ConversationSummary[];
  activityById: Readonly<Record<string, ConversationActivity>>;
  projectNameById: Readonly<Record<string, string>>;
}): NeedsYouInput[] {
  const roots = input.conversations.filter(
    (conversation) => !conversation.parentConversationId,
  );
  const byId = new Map(roots.map((entry) => [entry.id, entry]));
  const entry = (
    conversationId: string,
    kind: NeedsYouInput["kind"],
    title: string,
    itemId: string,
    at?: string,
    conversationTitle?: string,
  ): NeedsYouInput => {
    const conversation = byId.get(conversationId);
    return {
      id: itemId,
      kind,
      title,
      conversationId,
      conversationTitle: conversationTitle ?? conversation?.title ?? "",
      projectId: conversation?.projectId,
      projectName: conversation
        ? input.projectNameById[conversation.projectId]
        : undefined,
      at: at ?? conversation?.updatedAt ?? "",
    };
  };
  const needsYou = buildMobileInbox({
    conversations: roots,
    activityById: input.activityById,
  }).needsYou.map((item) => {
    const activity = input.activityById[item.conversationId];
    return entry(
      item.conversationId,
      activity?.indicator === "needs-user" ? "attention" : "failed",
      activity?.indicator === "aborted"
        ? "Agent interrupted"
        : (activity?.statusText ?? "Needs your attention"),
      item.id,
      item.at,
      item.title,
    );
  });
  const finished = roots
    .filter(
      (conversation) =>
        input.activityById[conversation.id]?.indicator === "result-ready",
    )
    .map((conversation) =>
      entry(conversation.id, "finished", "Agent finished", conversation.id),
    );
  return [...needsYou, ...finished];
}
