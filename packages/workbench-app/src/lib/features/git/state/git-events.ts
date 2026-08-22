import { onEvent, type WorkbenchEvent } from "$lib/kernel/events/event-bus";
import type { GitAutoRefreshDemand } from "./git-auto-refresh-scheduler";
import { gitEventRefreshRequest } from "./git-event-policy";
import {
  invalidateGitOverviewFromFilesystem,
  scheduleAutomaticGitRefresh,
} from "./git-panel.svelte";

type ScheduleRefresh = (
  projectId: string,
  repo: string,
  demand: GitAutoRefreshDemand,
) => void;

export function registerGitEventHandlers(
  schedule: ScheduleRefresh = scheduleAutomaticGitRefresh,
): () => void {
  const handle = (event: WorkbenchEvent): void => {
    try {
      const request = gitEventRefreshRequest(event);
      if (!request) return;
      if (event.type === "git.repository.invalidated") {
        invalidateGitOverviewFromFilesystem(request.projectId, request.repo);
        return;
      }
      schedule(request.projectId, request.repo, request.demand);
    } catch {
      // Event reducers must not prevent workspace cursor advancement.
    }
  };
  const unregisterInvalidated = onEvent("git.repository.invalidated", handle);
  const unregisterChanged = onEvent("git.repository.changed", handle);
  return () => {
    unregisterInvalidated();
    unregisterChanged();
  };
}
