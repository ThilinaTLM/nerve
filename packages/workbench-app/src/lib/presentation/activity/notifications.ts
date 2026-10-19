import { isActivityRunning, type Activity } from "@nervekit/contracts/activity";

export type NotificationKind =
  | "attention"
  | "running"
  | "failed"
  | "cancelled"
  | "succeeded";
export type NotificationChild = {
  id: string;
  title: string;
  status: "done" | "running" | "queued" | "failed";
};
export type NotificationAction = {
  label: string;
  intent: "open" | "cancel" | "retry";
};
export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  /** Muted line: repo, or project · conversation. */
  context: string;
  /** Error text shown (clamped) under the context. */
  detail?: string;
  /** Start time while running, otherwise when it finished or began waiting. */
  at: string;
  progress?: { completed: number; total: number };
  children: NotificationChild[];
  action?: NotificationAction;
  unread: boolean;
  /** Present when the item navigates to a conversation. */
  conversationId?: string;
};

/** A conversation waiting on the user, derived from conversation state. */
export type NeedsYouInput = {
  id: string;
  conversationId: string;
  conversationTitle: string;
  projectId?: string;
  projectName?: string;
  at: string;
};

export type NotificationInput = {
  activities: readonly Activity[];
  needsYou: readonly NeedsYouInput[];
  activeProjectId?: string;
  readIds: ReadonlySet<string>;
};

/** Needs-you first, then running, then finished. */
export function notificationRank(item: Pick<NotificationItem, "kind">): number {
  return item.kind === "attention" ? 0 : item.kind === "running" ? 1 : 2;
}

const isFailure = (activity: Activity) =>
  activity.status === "failed" || activity.status === "interrupted";

function repositoryName(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).pop();
}

function childStatus(activity: Activity): NotificationChild["status"] {
  if (activity.status === "succeeded") return "done";
  if (activity.status === "queued") return "queued";
  if (activity.status === "running") return "running";
  return "failed";
}

function activityItem(
  activity: Activity,
  children: Activity[],
  input: NotificationInput,
): NotificationItem {
  const running = isActivityRunning(activity);
  const scope = activity.scope;
  const projectName =
    scope?.projectId && scope.projectId === input.activeProjectId
      ? undefined
      : (scope?.projectName ?? scope?.projectId);
  const finishedChildren = children.filter(
    (child) => child.status === "succeeded",
  ).length;
  const context = [
    projectName,
    repositoryName(scope?.repositoryPath),
    running ? (activity.phase ?? activity.message) : undefined,
    running && children.length
      ? `${finishedChildren} of ${children.length}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const progress =
    activity.progress ??
    (children.length
      ? { completed: finishedChildren, total: children.length }
      : undefined);
  const action: NotificationAction | undefined =
    running && activity.actions.cancel
      ? { label: "Stop", intent: "cancel" }
      : activity.actions.retry
        ? { label: "Retry", intent: "retry" }
        : undefined;
  return {
    id: activity.id,
    kind: running
      ? "running"
      : isFailure(activity)
        ? "failed"
        : activity.status === "cancelled"
          ? "cancelled"
          : "succeeded",
    title: activity.title,
    context,
    detail: isFailure(activity)
      ? (activity.error?.message ?? activity.message)
      : undefined,
    at: running
      ? activity.startedAt
      : (activity.finishedAt ?? activity.updatedAt),
    progress: running ? progress : undefined,
    children: children.map((child) => ({
      id: child.id,
      title: child.title,
      status: childStatus(child),
    })),
    action,
    unread: !running && !input.readIds.has(activity.id),
  };
}

export function buildNotifications(
  input: NotificationInput,
): NotificationItem[] {
  const ids = new Set(input.activities.map((activity) => activity.id));
  const childrenByParent = new Map<string, Activity[]>();
  for (const activity of input.activities) {
    if (!activity.parentId || !ids.has(activity.parentId)) continue;
    const siblings = childrenByParent.get(activity.parentId) ?? [];
    siblings.push(activity);
    childrenByParent.set(activity.parentId, siblings);
  }
  const attention = input.needsYou.map((entry): NotificationItem => {
    const id = `attention:${entry.id}`;
    return {
      id,
      kind: "attention",
      title: "Needs your attention",
      context: [
        entry.projectId === input.activeProjectId
          ? undefined
          : entry.projectName,
        entry.conversationTitle,
      ]
        .filter(Boolean)
        .join(" · "),
      at: entry.at,
      children: [],
      action: { label: "Open", intent: "open" },
      unread: !input.readIds.has(id),
      conversationId: entry.conversationId,
    };
  });
  const activities = input.activities
    // Children appear only under their parent, never at the top level.
    .filter((activity) => !activity.parentId)
    .map((activity) =>
      activityItem(activity, childrenByParent.get(activity.id) ?? [], input),
    );
  return [...attention, ...activities].sort(
    (a, b) =>
      notificationRank(a) - notificationRank(b) ||
      Date.parse(b.at) - Date.parse(a.at),
  );
}

/** Elapsed for running work, otherwise how long ago the item happened. */
export function notificationTime(item: NotificationItem, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(item.at)) / 1000));
  if (item.kind === "running")
    return seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
