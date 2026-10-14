import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationSummary, ToolCall } from "@nervekit/contracts/core";
import {
  type ConversationActivity,
  summaryActivity,
} from "../../conversations/conversation-activity.js";
export type MobileInboxKind =
  | "approval"
  | "question"
  | "plan"
  | "error"
  | "running"
  | "awaiting-async"
  | "recent";
export type MobileInboxInteraction = {
  kind: "approval" | "question" | "plan";
  id: string;
};
export type MobileInboxItem = {
  id: string;
  kind: MobileInboxKind;
  conversationId: string;
  title: string;
  kindLabel: string;
  detail: string;
  projectLabel?: string;
  tone: StatusTone;
  pulse: boolean;
  at?: string;
  interaction?: MobileInboxInteraction;
};
export type MobileInboxInput = {
  conversations: readonly ConversationSummary[];
  toolCalls?: readonly ToolCall[];
  activityById?: Readonly<Record<string, ConversationActivity>>;
  projectNameById?: Readonly<Record<string, string>>;
  recentLimit?: number;
};
export type MobileInboxModel = {
  needsYou: MobileInboxItem[];
  running: MobileInboxItem[];
  awaitingAsync: MobileInboxItem[];
  recent: MobileInboxItem[];
};
export function buildMobileInbox(input: MobileInboxInput): MobileInboxModel {
  const model: MobileInboxModel = {
    needsYou: [],
    running: [],
    awaitingAsync: [],
    recent: [],
  };
  const byId = new Map(
    input.conversations.map((conversation) => [conversation.id, conversation]),
  );
  const claimed = new Set<string>();
  for (const call of input.toolCalls ?? []) {
    if (
      !call.interaction ||
      !["awaiting_approval", "awaiting_input"].includes(call.state)
    )
      continue;
    const conversation = byId.get(call.conversationId);
    const interaction = call.interaction;
    const kind =
      interaction.kind === "approval"
        ? "approval"
        : interaction.kind === "user_input"
          ? "question"
          : "plan";
    claimed.add(call.conversationId);
    model.needsYou.push({
      id: call.id,
      kind,
      conversationId: call.conversationId,
      title: conversation?.title ?? "Conversation",
      kindLabel:
        kind === "approval"
          ? "Approval"
          : kind === "question"
            ? "Question"
            : "Plan review",
      detail:
        interaction.kind === "approval"
          ? interaction.request.reason
          : interaction.kind === "user_input"
            ? interaction.request.question
            : interaction.request.path,
      tone: "warning",
      pulse: false,
      at: call.updatedAt,
      projectLabel: conversation
        ? input.projectNameById?.[conversation.projectId]
        : undefined,
      interaction: { kind, id: call.id },
    });
  }
  for (const conversation of [...input.conversations].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (claimed.has(conversation.id)) continue;
    const activity =
      input.activityById?.[conversation.id] ?? summaryActivity(conversation);
    const item: MobileInboxItem = {
      id: conversation.id,
      kind:
        activity.indicator === "running"
          ? "running"
          : activity.indicator === "needs-user"
            ? "question"
            : activity.indicator === "error"
              ? "error"
              : activity.indicator === "awaiting-async"
                ? "awaiting-async"
                : "recent",
      conversationId: conversation.id,
      title: conversation.title,
      kindLabel: activity.label ?? "Recent",
      detail: activity.label ?? "",
      tone: activity.tone,
      pulse: activity.pulse,
      at: conversation.updatedAt,
      projectLabel: input.projectNameById?.[conversation.projectId],
    };
    if (item.kind === "running") model.running.push(item);
    else if (item.kind === "error" || item.kind === "question")
      model.needsYou.push(item);
    else if (item.kind === "awaiting-async") model.awaitingAsync.push(item);
    else if (model.recent.length < (input.recentLimit ?? 8))
      model.recent.push(item);
  }
  return model;
}
