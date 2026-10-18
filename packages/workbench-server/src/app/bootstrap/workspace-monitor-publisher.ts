import type { WorkspaceMonitorPublisher } from "../../domains/monitoring/workspace-monitor.js";

export function createWorkspaceMonitorPublisher(
  events: WorkspaceMonitorPublisher,
  git: {
    invalidateProjectReads(
      projectId: string,
      options?: { uncertain?: boolean },
    ): void;
  },
): WorkspaceMonitorPublisher {
  return {
    publishBestEffort(type, data, context) {
      if (typeof data.projectId === "string") {
        git.invalidateProjectReads(
          data.projectId,
          data.refreshCause === "uncertain_poll"
            ? { uncertain: true }
            : undefined,
        );
      }
      events.publishBestEffort(type, data, context);
    },
  };
}
