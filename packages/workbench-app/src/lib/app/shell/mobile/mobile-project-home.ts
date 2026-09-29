import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationRecord } from "@nervekit/contracts/conversations";

/**
 * Project home on a phone: the few conversations worth reopening first, then
 * one summary line per project tool so the list reads as a dashboard.
 */

export const PROJECT_HOME_RECENT_LIMIT = 5;

type ActivityLike = { tone: StatusTone; label?: string; busy: boolean };

export type MobileProjectHomeInput = {
  conversations: readonly ConversationRecord[];
  activityById: Readonly<Record<string, ActivityLike | undefined>>;
  liveTaskCount: number;
  git?: { changeCount: number; branch?: string };
  prCount: number;
};

export type MobileProjectHomeModel = {
  recent: ConversationRecord[];
  conversationCount: number;
  tasksDetail: string;
  gitDetail: string;
  pullRequestsDetail: string;
};

function lastPromptAt(conversation: ConversationRecord): string {
  return conversation.lastUserMessageAt ?? conversation.createdAt;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildMobileProjectHome(
  input: MobileProjectHomeInput,
): MobileProjectHomeModel {
  const recent = input.conversations
    .filter(
      (conversation) =>
        !conversation.completedAt || input.activityById[conversation.id]?.busy,
    )
    .toSorted((left, right) => {
      const busy =
        Number(Boolean(input.activityById[right.id]?.busy)) -
        Number(Boolean(input.activityById[left.id]?.busy));
      return busy || lastPromptAt(right).localeCompare(lastPromptAt(left));
    })
    .slice(0, PROJECT_HOME_RECENT_LIMIT);

  const git = input.git;
  return {
    recent,
    conversationCount: input.conversations.length,
    tasksDetail:
      input.liveTaskCount > 0
        ? `${plural(input.liveTaskCount, "task", "tasks")} running`
        : "No running tasks",
    gitDetail: !git
      ? "No repository"
      : git.changeCount > 0
        ? `${plural(git.changeCount, "uncommitted change", "uncommitted changes")}`
        : "Working tree clean",
    pullRequestsDetail:
      input.prCount > 0 ? `${input.prCount} open` : "No open pull requests",
  };
}
