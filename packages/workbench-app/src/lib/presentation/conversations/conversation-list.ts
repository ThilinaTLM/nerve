import type { ConversationActivity } from "./conversation-activity";
import {
  compareConversationsByLastUserPromptDesc,
  conversationLastUserPromptAt,
  type ConversationSummary,
} from "@nervekit/contracts/core";

export type ConversationIdentity = Pick<
  ConversationSummary,
  "id" | "title" | "createdAt" | "lastUserMessageAt" | "completedAt"
> & { pinned: boolean };

export type ConversationListRow = { conversation: ConversationIdentity };

function attentionRank(activity: ConversationActivity | undefined): number {
  switch (activity?.indicator) {
    case "needs-user":
      return 0;
    case "error":
    case "aborted":
      return 1;
    case "result-ready":
      return 2;
    default:
      return 3;
  }
}

export function compareConversationRowsByCompletionThenUserPrompt(
  a: ConversationListRow,
  b: ConversationListRow,
): number {
  const completionCompare =
    Number(Boolean(a.conversation.completedAt)) -
    Number(Boolean(b.conversation.completedAt));
  return (
    completionCompare ||
    compareConversationsByLastUserPromptDesc(a.conversation, b.conversation)
  );
}

export type ConversationSection<
  R extends ConversationListRow = ConversationListRow,
> = {
  key:
    | "needs-you"
    | "pinned"
    | "today"
    | "yesterday"
    | "previous-7-days"
    | "older";
  label: string;
  rows: R[];
};

const CONVERSATION_SECTION_LABELS: Record<ConversationSection["key"], string> =
  {
    pinned: "Pinned",
    "needs-you": "Needs you",
    today: "Today",
    yesterday: "Yesterday",
    "previous-7-days": "Previous 7 days",
    older: "Older",
  };

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function conversationDateSectionKey(
  conversation: ConversationIdentity,
  now: Date,
): Exclude<ConversationSection["key"], "pinned" | "needs-you"> {
  const lastUserPrompt = new Date(conversationLastUserPromptAt(conversation));
  if (Number.isNaN(lastUserPrompt.getTime())) return "older";
  const today = startOfLocalDay(now);
  const lastUserPromptDay = startOfLocalDay(lastUserPrompt);
  if (lastUserPromptDay.getTime() >= today.getTime()) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (lastUserPromptDay.getTime() >= yesterday.getTime()) return "yesterday";
  const previousWeek = new Date(today);
  previousWeek.setDate(previousWeek.getDate() - 7);
  return lastUserPromptDay.getTime() >= previousWeek.getTime()
    ? "previous-7-days"
    : "older";
}

export function buildConversationSections<
  R extends ConversationListRow,
>(options: {
  rows: R[];
  activityById?: Readonly<Record<string, ConversationActivity>>;
  now?: Date;
  hideCompleted?: boolean;
}): ConversationSection<R>[] {
  const activityById = options.activityById ?? {};
  const rows = options.rows.filter(
    (row) =>
      !options.hideCompleted ||
      !row.conversation.completedAt ||
      activityById[row.conversation.id]?.indicator === "needs-user",
  );
  const now = options.now ?? new Date();
  const byKey = new Map<ConversationSection["key"], R[]>();
  for (const row of rows) {
    const key = row.conversation.pinned
      ? "pinned"
      : attentionRank(activityById[row.conversation.id]) < 3
        ? "needs-you"
        : conversationDateSectionKey(row.conversation, now);
    const sectionRows = byKey.get(key) ?? [];
    sectionRows.push(row);
    byKey.set(key, sectionRows);
  }
  const order: ConversationSection["key"][] = [
    "pinned",
    "needs-you",
    "today",
    "yesterday",
    "previous-7-days",
    "older",
  ];
  return order.flatMap((key) => {
    const sectionRows = byKey.get(key);
    return sectionRows?.length
      ? [
          {
            key,
            label: CONVERSATION_SECTION_LABELS[key],
            rows: sectionRows.sort(
              (a, b) =>
                (key === "needs-you"
                  ? attentionRank(activityById[a.conversation.id]) -
                    attentionRank(activityById[b.conversation.id])
                  : 0) ||
                (key === "pinned" || key === "needs-you"
                  ? compareConversationsByLastUserPromptDesc(
                      a.conversation,
                      b.conversation,
                    )
                  : compareConversationRowsByCompletionThenUserPrompt(a, b)),
            ),
          },
        ]
      : [];
  });
}

export function limitConversationSections<R extends ConversationListRow>(
  sections: ConversationSection<R>[],
  limit: number,
): ConversationSection<R>[] {
  let remaining = limit;
  return sections.flatMap((section) => {
    if (remaining <= 0) return [];
    const rows = section.rows.slice(0, remaining);
    remaining -= rows.length;
    return rows.length ? [{ ...section, rows }] : [];
  });
}
