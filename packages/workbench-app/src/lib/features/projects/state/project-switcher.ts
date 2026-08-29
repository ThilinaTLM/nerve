import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationRecord, ProjectRecord, TaskRecord } from "$lib/api";
import { isPathInDirectory } from "$lib/domain/filesystem/project-path";
import {
  conversationLastUserPromptAt,
  projectFolderName,
  projectKey,
  shortProjectLabel,
} from "$lib/domain/projects/project-tree";
import type { ConversationActivityState } from "$lib/domain/conversations/activity";

export type ProjectActivitySummary = {
  needsUser: number;
  failed: number;
  running: number;
};

export type ProjectTaskSummary = {
  running: number;
};

export type ProjectSwitcherItem = {
  key: string;
  project: ProjectRecord;
  projectIds: string[];
  label: string;
  sortAt: string;
  lastAccessedAt?: number;
  conversationCount: number;
  activity: ProjectActivitySummary;
  tasks: ProjectTaskSummary;
};

export function summarizeProjectActivity(
  conversations: ConversationRecord[],
  activityById: Record<string, ConversationActivityState>,
): ProjectActivitySummary {
  const summary: ProjectActivitySummary = {
    needsUser: 0,
    failed: 0,
    running: 0,
  };
  for (const conversation of conversations) {
    if (conversation.completedAt) continue;
    const activity = activityById[conversation.id];
    if (!activity) continue;
    if (activity.needsUser) summary.needsUser += 1;
    else if (activity.tone === "danger") summary.failed += 1;
    else if (activity.busy) summary.running += 1;
  }
  return summary;
}

export type ProjectActivitySignal = {
  tone: Extract<StatusTone, "warn" | "danger" | "running">;
  count: number;
  /** Human-readable breakdown of current actionable activity. */
  summary: string;
};

export function projectActivitySignal(
  activity: ProjectActivitySummary,
  tasks: ProjectTaskSummary,
): ProjectActivitySignal | undefined {
  const parts = [
    activity.needsUser ? `${activity.needsUser} waiting for you` : "",
    activity.failed ? `${activity.failed} failed` : "",
    activity.running
      ? `${activity.running} conversation${activity.running === 1 ? "" : "s"} running`
      : "",
    tasks.running
      ? `${tasks.running} background task${tasks.running === 1 ? "" : "s"} running`
      : "",
  ].filter(Boolean);
  if (!parts.length) return undefined;
  const tone: ProjectActivitySignal["tone"] = activity.needsUser
    ? "warn"
    : activity.failed
      ? "danger"
      : "running";
  return {
    tone,
    count:
      activity.needsUser + activity.failed + activity.running + tasks.running,
    summary: parts.join(", "),
  };
}

export function buildProjectSwitcherItems(input: {
  projects: ProjectRecord[];
  conversations: ConversationRecord[];
  tasks: TaskRecord[];
  activityById: Record<string, ConversationActivityState>;
  homeDir?: string;
  recency?: Record<string, number>;
}): ProjectSwitcherItem[] {
  const byKey = new Map<string, ProjectRecord[]>();
  for (const project of input.projects) {
    const key = projectKey(project);
    byKey.set(key, [...(byKey.get(key) ?? []), project]);
  }

  const projectKeyById = new Map<string, string>();
  for (const [key, projects] of byKey) {
    for (const project of projects) projectKeyById.set(project.id, key);
  }

  const runningTasksByKey = new Map<string, number>();
  const activeTaskStatuses = new Set<TaskRecord["status"]>([
    "starting",
    "running",
    "ready",
    "stopping",
  ]);
  for (const task of input.tasks) {
    if (
      task.visibility !== "background" ||
      !activeTaskStatuses.has(task.status)
    ) {
      continue;
    }

    let key = task.projectId ? projectKeyById.get(task.projectId) : undefined;
    if (!key) {
      let longestMatch = -1;
      for (const [candidateKey, projects] of byKey) {
        const dir = projects[0]?.dir;
        if (
          dir &&
          dir.length > longestMatch &&
          isPathInDirectory(task.cwd, dir)
        ) {
          key = candidateKey;
          longestMatch = dir.length;
        }
      }
    }
    if (key) {
      runningTasksByKey.set(key, (runningTasksByKey.get(key) ?? 0) + 1);
    }
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
      .map(conversationLastUserPromptAt)
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
      conversationCount: conversations.length,
      activity: summarizeProjectActivity(conversations, input.activityById),
      tasks: { running: runningTasksByKey.get(key) ?? 0 },
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
