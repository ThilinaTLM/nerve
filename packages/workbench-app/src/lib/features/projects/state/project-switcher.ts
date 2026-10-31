import { conversationLastUserPromptAt } from "@nervekit/contracts/core";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { Project } from "@nervekit/contracts/core";
import type { ProjectRecord } from "$lib/domain/projects/sidebar-view-models";
import {
  projectFolderName,
  projectKey,
  shortProjectLabel,
} from "$lib/domain/projects/project-tree";
import {
  idleConversationActivity,
  type ConversationActivity,
} from "$lib/presentation/conversations/conversation-activity";

export type ProjectSwitcherItem = {
  key: string;
  project: ProjectRecord;
  projectIds: string[];
  label: string;
  sortAt: string;
  lastAccessedAt?: number;
  conversationCount: number;
  /** The project's most urgent conversation activity, shown with the same
   * glyph and label as that conversation in the conversation list. */
  activity: ConversationActivity;
};

/** Most urgent first; `completed` and `idle` never surface on a project. */
const PROJECT_ACTIVITY_PRIORITY: readonly ConversationActivity["indicator"][] =
  [
    "needs-user",
    "error",
    "aborted",
    "running",
    "awaiting-async",
    "result-ready",
  ];

export function projectActivity(
  conversations: readonly ConversationSummary[],
  activityById: Record<string, ConversationActivity>,
): ConversationActivity {
  let winner: ConversationActivity | undefined;
  let winnerRank = PROJECT_ACTIVITY_PRIORITY.length;
  for (const conversation of conversations) {
    const activity = activityById[conversation.id];
    if (!activity) continue;
    const rank = PROJECT_ACTIVITY_PRIORITY.indexOf(activity.indicator);
    if (rank >= 0 && rank < winnerRank) {
      winner = activity;
      winnerRank = rank;
    }
  }
  return winner ?? idleConversationActivity;
}

/** Waiting on the user, failed, or interrupted. */
export function projectNeedsAttention(item: ProjectSwitcherItem): boolean {
  const { indicator } = item.activity;
  return (
    indicator === "needs-user" ||
    indicator === "error" ||
    indicator === "aborted"
  );
}

export function buildProjectSwitcherItems(input: {
  projects: Project[];
  conversations: ConversationSummary[];
  activityById: Record<string, ConversationActivity>;
  homeDir?: string;
  recency?: Record<string, number>;
}): ProjectSwitcherItem[] {
  const byKey = new Map<string, Project[]>();
  for (const project of input.projects) {
    const key = projectKey(project);
    byKey.set(key, [...(byKey.get(key) ?? []), project]);
  }

  const projectKeyById = new Map<string, string>();
  for (const [key, projects] of byKey) {
    for (const project of projects) projectKeyById.set(project.id, key);
  }

  const folderCounts = new Map<string, number>();
  for (const projects of byKey.values()) {
    const folder = projectFolderName(projects[0].directory);
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
  }

  const items = [...byKey.entries()].map(([key, projects]) => {
    const project = [...projects].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    const projectIds = projects.map((candidate) => candidate.id);
    const idSet = new Set(projectIds);
    const conversations = input.conversations.filter(
      (conversation) =>
        idSet.has(conversation.projectId) &&
        conversation.parentConversationId === null,
    );
    const latestConversation = conversations
      .map(conversationLastUserPromptAt)
      .sort((a, b) => b.localeCompare(a))[0];
    const folder = projectFolderName(project.directory);
    return {
      key,
      project: { ...project, dir: project.directory },
      projectIds,
      label:
        (folderCounts.get(folder) ?? 0) > 1
          ? shortProjectLabel(project.directory, input.homeDir)
          : folder,
      sortAt:
        latestConversation && latestConversation > project.updatedAt
          ? latestConversation
          : project.updatedAt,
      lastAccessedAt: input.recency?.[key],
      conversationCount: conversations.length,
      activity: projectActivity(conversations, input.activityById),
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

/**
 * Header strip: the most recent projects plus the active one, and any project
 * that needs the user even when it has not been visited lately. Alphabetical,
 * so a project keeps its place while recency shifts underneath it.
 */
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
  const promoted = items.filter(
    (item) => projectNeedsAttention(item) && !recent.includes(item),
  );
  return [...recent, ...promoted].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}
