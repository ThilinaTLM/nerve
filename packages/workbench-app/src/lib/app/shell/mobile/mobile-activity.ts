import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import { isPathInDirectory } from "$lib/domain/filesystem/project-path";

/**
 * The phone Activity tab: everything moving right now, across projects.
 * Conversations and background tasks are joined to their project so a row
 * answers "what, where, how long" at arm's length.
 */

export const LIVE_TASK_STATUSES: ReadonlySet<TaskRecord["status"]> = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
]);

/** Errors older than this have been seen or no longer matter on a phone. */
const RECENT_ERROR_MS = 24 * 60 * 60 * 1000;

type ActivityLike = {
  indicator:
    | "idle"
    | "running"
    | "needs-user"
    | "awaiting-async"
    | "error"
    | "aborted"
    | "completed";
  tone: StatusTone;
  label?: string;
  busy: boolean;
};

type ProjectLike = { id: string; name: string; directory: string };

export type MobileActivityConversation = {
  conversationId: string;
  title: string;
  projectLabel?: string;
  detail: string;
  tone: StatusTone;
  pulse: boolean;
  at: string;
};

export type MobileActivityTask = {
  taskId: string;
  title: string;
  projectLabel?: string;
  detail: string;
  tone: StatusTone;
  pulse: boolean;
  at: string;
};

export type MobileActivityModel = {
  conversations: MobileActivityConversation[];
  tasks: MobileActivityTask[];
};

export type MobileActivityInput = {
  conversations: readonly ConversationSummary[];
  activityById: Readonly<Record<string, ActivityLike>>;
  tasks: readonly TaskRecord[];
  projects: readonly ProjectLike[];
  now?: number;
};

const CONVERSATION_ORDER: Partial<Record<ActivityLike["indicator"], number>> = {
  running: 0,
  "needs-user": 1,
  "awaiting-async": 2,
  error: 3,
};

export function taskTitle(task: TaskRecord): string {
  return task.displayName ?? task.name ?? task.command;
}

export function taskProject<P extends ProjectLike>(
  task: TaskRecord,
  projects: readonly P[],
): P | undefined {
  if (task.projectId) {
    const owned = projects.find((project) => project.id === task.projectId);
    if (owned) return owned;
  }
  // Deepest matching directory wins for nested projects.
  return projects
    .filter((project) => isPathInDirectory(task.cwd, project.directory))
    .sort((left, right) => right.directory.length - left.directory.length)[0];
}

/**
 * Tasks owned by one project. Ownership is resolved against every project so
 * a task under a nested project belongs to the child, never the parent too.
 */
export function tasksInProject<P extends ProjectLike>(
  tasks: readonly TaskRecord[],
  projects: readonly P[],
  projectId: string,
): TaskRecord[] {
  return tasks.filter((task) => taskProject(task, projects)?.id === projectId);
}

export function buildMobileActivity(
  input: MobileActivityInput,
): MobileActivityModel {
  const now = input.now ?? Date.now();
  const projectNameById = new Map(
    input.projects.map((project) => [project.id, project.name]),
  );

  const ranked: { rank: number; row: MobileActivityConversation }[] = [];
  for (const conversation of input.conversations) {
    const activity = input.activityById[conversation.id];
    if (!activity) continue;
    const rank = activity.busy ? 0 : CONVERSATION_ORDER[activity.indicator];
    if (rank === undefined) continue;
    if (
      activity.indicator === "error" &&
      now - Date.parse(conversation.updatedAt) > RECENT_ERROR_MS
    ) {
      continue;
    }
    ranked.push({
      rank,
      row: {
        conversationId: conversation.id,
        title: conversation.title,
        projectLabel: projectNameById.get(conversation.projectId),
        detail: activity.label ?? defaultConversationDetail(activity.indicator),
        tone: activity.tone,
        pulse: activity.busy,
        at: conversation.updatedAt,
      },
    });
  }
  ranked.sort(
    (left, right) =>
      left.rank - right.rank || right.row.at.localeCompare(left.row.at),
  );

  const tasks = input.tasks
    .filter((task) => LIVE_TASK_STATUSES.has(task.status))
    .map(
      (task): MobileActivityTask => ({
        taskId: task.id,
        title: taskTitle(task),
        projectLabel: taskProject(task, input.projects)?.name,
        detail: taskDetail(task),
        tone: task.status === "stopping" ? "warning" : "info",
        pulse: task.status !== "ready",
        at: task.startedAt,
      }),
    )
    .sort((left, right) => right.at.localeCompare(left.at));

  return {
    conversations: ranked.map(({ row }) => row),
    tasks,
  };
}

function defaultConversationDetail(
  indicator: ActivityLike["indicator"],
): string {
  switch (indicator) {
    case "needs-user":
      return "Waiting for you";
    case "awaiting-async":
      return "Waiting for background work";
    case "error":
      return "Needs attention";
    default:
      return "Agent running";
  }
}

function taskDetail(task: TaskRecord): string {
  switch (task.status) {
    case "starting":
      return "Starting";
    case "ready":
      return "Ready";
    case "stopping":
      return "Stopping";
    default:
      return "Running";
  }
}
