import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import type { LaunchRecord } from "@nervekit/contracts/launches";

/**
 * The phone Activity tab: everything moving right now, across projects.
 * Conversations and background launches are joined to their project so a row
 * answers "what, where, how long" at arm's length.
 */

export const LIVE_LAUNCH_STATUSES: ReadonlySet<LaunchRecord["status"]> =
  new Set(["starting", "running", "ready", "stopping"]);

/** Errors older than this have been seen or no longer matter on a phone. */
const RECENT_ERROR_MS = 24 * 60 * 60 * 1000;

type ActivityLike = Pick<
  ConversationActivity,
  "indicator" | "tone" | "label" | "busy"
>;

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

export type MobileActivityLaunch = {
  launchId: string;
  title: string;
  projectLabel?: string;
  detail: string;
  tone: StatusTone;
  pulse: boolean;
  at: string;
};

export type MobileActivityModel = {
  conversations: MobileActivityConversation[];
  launches: MobileActivityLaunch[];
};

export type MobileActivityInput = {
  conversations: readonly ConversationSummary[];
  activityById: Readonly<Record<string, ActivityLike>>;
  launches: readonly LaunchRecord[];
  projects: readonly ProjectLike[];
  now?: number;
};

const CONVERSATION_ORDER: Partial<Record<ActivityLike["indicator"], number>> = {
  "needs-user": 0,
  error: 1,
  running: 2,
  "awaiting-async": 3,
};

export function launchTitle(launch: LaunchRecord): string {
  return launch.displayName ?? launch.name ?? launch.command;
}

export function launchProject<P extends ProjectLike>(
  launch: LaunchRecord,
  projects: readonly P[],
): P | undefined {
  return projects.find((project) => project.id === launch.projectId);
}

/**
 * Launches owned by one project. Ownership is resolved against every project so
 * a launch under a nested project belongs to the child, never the parent too.
 */
export function launchesInProject<P extends ProjectLike>(
  launches: readonly LaunchRecord[],
  projects: readonly P[],
  projectId: string,
): LaunchRecord[] {
  return launches.filter(
    (launch) => launchProject(launch, projects)?.id === projectId,
  );
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
    const rank = CONVERSATION_ORDER[activity.indicator];
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

  const launches = input.launches
    .filter((launch) => LIVE_LAUNCH_STATUSES.has(launch.status))
    .map(
      (launch): MobileActivityLaunch => ({
        launchId: launch.id,
        title: launchTitle(launch),
        projectLabel: launchProject(launch, input.projects)?.name,
        detail: launchDetail(launch),
        tone: launch.status === "stopping" ? "warning" : "info",
        pulse: launch.status !== "ready",
        at: launch.startedAt,
      }),
    )
    .sort((left, right) => right.at.localeCompare(left.at));

  return {
    conversations: ranked.map(({ row }) => row),
    launches,
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

function launchDetail(launch: LaunchRecord): string {
  switch (launch.status) {
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
