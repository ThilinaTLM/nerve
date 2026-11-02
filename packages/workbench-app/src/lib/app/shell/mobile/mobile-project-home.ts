import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationSummary } from "@nervekit/contracts/core";

/**
 * Project home on a phone: the few conversations worth reopening first, then
 * the repository status and a tile per project tool so it reads as a dashboard.
 */

export const PROJECT_HOME_RECENT_LIMIT = 5;

type ActivityLike = { tone: StatusTone; label?: string; busy: boolean };

export type MobileProjectHomeInput = {
  conversations: readonly ConversationSummary[];
  activityById: Readonly<Record<string, ActivityLike | undefined>>;
  liveLaunchCount: number;
  git?: {
    changeCount: number;
    branch?: string;
    ahead?: number | null;
    behind?: number | null;
    hasUpstream?: boolean;
    detached?: boolean;
  };
  prCount: number;
};

export type MobileProjectHomeModel = {
  recent: ConversationSummary[];
  conversationCount: number;
  /** Present when the project is a repository. */
  repo?: { branch: string; sync?: string };
  changedCount: number;
  prCount: number;
  liveLaunchCount: number;
};

function lastPromptAt(conversation: ConversationSummary): string {
  return conversation.lastUserMessageAt ?? conversation.createdAt;
}

/** "↑2 ↓0" against the upstream; nothing when there is none to compare. */
export function repoSyncLabel(git: {
  ahead?: number | null;
  behind?: number | null;
  hasUpstream?: boolean;
}): string | undefined {
  if (!git.hasUpstream) return undefined;
  return `↑${git.ahead ?? 0} ↓${git.behind ?? 0}`;
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
    repo: git
      ? {
          branch: git.detached ? "Detached HEAD" : (git.branch ?? "HEAD"),
          sync: repoSyncLabel(git),
        }
      : undefined,
    changedCount: git?.changeCount ?? 0,
    prCount: input.prCount,
    liveLaunchCount: input.liveLaunchCount,
  };
}
