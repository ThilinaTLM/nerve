import type { WorkbenchEvent } from "$lib/application/events/workbench-event-bus";
import type { GitAutoRefreshDemand } from "./git-auto-refresh-scheduler";

export type GitEventRefreshRequest = {
  projectId: string;
  repo: string;
  demand: GitAutoRefreshDemand;
  refreshDiscovery?: boolean;
};

export function gitEventRefreshRequest(
  event: Pick<WorkbenchEvent, "type" | "data">,
): GitEventRefreshRequest | undefined {
  const projectId = stringValue(event.data?.projectId);
  const repo = stringValue(event.data?.repo);
  if (!projectId?.startsWith("proj_") || !repo) return undefined;

  if (event.type === "git.repository.invalidated") {
    return {
      projectId,
      repo,
      demand: {
        overview: true,
        ...(event.data?.refreshCause === "uncertain_poll"
          ? { uncertain: true }
          : {}),
      },
    };
  }
  if (event.type !== "git.repository.changed") return undefined;
  const reason = stringValue(event.data?.reason);
  return {
    projectId,
    repo,
    ...(reason === "repository.cloned" ? { refreshDiscovery: true } : {}),
    demand: {
      overview: true,
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
