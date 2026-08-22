import type { WorkbenchEvent } from "$lib/kernel/events/event-bus";
import type { GitAutoRefreshDemand } from "./git-auto-refresh-scheduler";

const PR_RELEVANT_REASONS = new Set([
  "branch.created",
  "branch.switched",
  "branch.synced",
  "base.updated",
  "remote.fetched",
  "remote.pulled",
  "remote.pushed",
  "github.pr.checked_out",
]);

export type GitEventRefreshRequest = {
  projectId: string;
  repo: string;
  demand: GitAutoRefreshDemand;
};

export function gitEventRefreshRequest(
  event: Pick<WorkbenchEvent, "type" | "data">,
): GitEventRefreshRequest | undefined {
  const projectId = stringValue(event.data?.projectId);
  const repo = stringValue(event.data?.repo);
  if (!projectId?.startsWith("proj_") || !repo) return undefined;

  if (event.type === "git.repository.invalidated") {
    return { projectId, repo, demand: { overview: true } };
  }
  if (event.type !== "git.repository.changed") return undefined;
  const reason = stringValue(event.data?.reason);
  return {
    projectId,
    repo,
    demand: {
      overview: true,
      ...(reason && PR_RELEVANT_REASONS.has(reason) ? { prs: true } : {}),
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
