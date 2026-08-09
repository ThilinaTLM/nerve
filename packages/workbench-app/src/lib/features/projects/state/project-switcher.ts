import type { StatusTone } from "@nervekit/ui-kit/core/utils/status";
import type { ConversationRecord, ProjectRecord } from "$lib/api";
import {
  conversationLastUserSortAt,
  projectFolderName,
  projectKey,
  shortProjectLabel,
} from "$lib/core/utils/project-tree";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";

export type ProjectActivitySummary = {
  needsUser: number;
  running: number;
};

export type ProjectSwitcherItem = {
  key: string;
  project: ProjectRecord;
  projectIds: string[];
  label: string;
  sortAt: string;
  lastAccessedAt?: number;
  activity: ProjectActivitySummary;
};

export function summarizeProjectActivity(
  conversations: ConversationRecord[],
  activityById: Record<string, ConversationActivityState>,
): ProjectActivitySummary {
  const summary: ProjectActivitySummary = {
    needsUser: 0,
    running: 0,
  };
  for (const conversation of conversations) {
    const activity = activityById[conversation.id];
    if (!activity) continue;
    if (activity.needsUser) summary.needsUser += 1;
    else if (activity.busy && activity.tone !== "danger") summary.running += 1;
  }
  return summary;
}

export type ProjectActivityIndicator = {
  tone: StatusTone;
  pulse: boolean;
  /** Human-readable breakdown of current actionable activity. */
  summary: string;
};

export function projectActivityIndicator(
  activity: ProjectActivitySummary,
): ProjectActivityIndicator | undefined {
  const parts = [
    activity.needsUser ? `${activity.needsUser} waiting for you` : "",
    activity.running ? `${activity.running} running` : "",
  ].filter(Boolean);
  if (!parts.length) return undefined;
  const tone: StatusTone = activity.needsUser ? "warn" : "running";
  return { tone, pulse: tone === "running", summary: parts.join(", ") };
}

export function buildProjectSwitcherItems(input: {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  activityById: Record<string, ConversationActivityState>;
  homeDir?: string;
  recency?: Record<string, number>;
}): ProjectSwitcherItem[] {
  const byKey = new Map<string, ProjectRecord[]>();
  for (const project of input.projects) {
    const key = projectKey(project);
    byKey.set(key, [...(byKey.get(key) ?? []), project]);
  }

  const folderCounts = new Map<string, number>();
  for (const projects of byKey.values()) {
    const folder = projectFolderName(projects[0].dir);
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }

  const items = [...byKey.entries()].map(([key, projects]) => {
    const project = [...projects].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    const projectIds = projects.map((candidate) => candidate.id);
    const idSet = new Set(projectIds);
    const conversations = input.conversations.filter((conversation) =>
      idSet.has(conversation.projectId),
    );
    const latestConversation = conversations
      .map(conversationLastUserSortAt)
      .sort((a, b) => b.localeCompare(a))[0];
    const folder = projectFolderName(project.dir);
    return {
      key,
      project,
      projectIds,
      label:
        (folderCounts.get(folder) ?? 0) > 1
          ? shortProjectLabel(project.dir, input.homeDir)
          : folder,
      sortAt:
        latestConversation && latestConversation > project.updatedAt
          ? latestConversation
          : project.updatedAt,
      lastAccessedAt: input.recency?.[key],
      activity: summarizeProjectActivity(conversations, input.activityById),
    };
  });

  return items.sort((a, b) => {
    const recent =
      (input.recency?.[b.key] ?? 0) - (input.recency?.[a.key] ?? 0);
    if (recent !== 0) return recent;
    const updated = b.sortAt.localeCompare(a.sortAt);
    return updated || a.label.localeCompare(b.label);
  });
}

export function quickProjectItems(
  items: ProjectSwitcherItem[],
  activeKey: string | undefined,
  limit: number,
): ProjectSwitcherItem[] {
  if (limit <= 0) return [];
  const recent = items.slice(0, limit);
  const active = items.find((item) => item.key === activeKey);
  if (active && !recent.some((item) => item.key === active.key)) {
    recent.splice(Math.max(0, recent.length - 1), 1, active);
  }
  return recent.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}
