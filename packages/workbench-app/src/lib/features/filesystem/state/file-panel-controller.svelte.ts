import { onWorkbenchReconnect } from "$lib/application/events/workbench-event-bus";
import { clearProjectMonitor, syncProjectMonitor } from "../api/filesystem.api";
import {
  ensureFileExplorerRoot,
  monitoredFileExplorerDirectories,
} from "./file-explorer-actions.svelte";
import { registerFileExplorerEventHandler } from "./file-explorer-events";
import { createFilePanelRefreshQueue } from "./file-panel-refresh-queue";
import { startFileExplorerRefreshScheduler } from "./file-explorer-refresh-scheduler";
import {
  describeFileMonitorFailure,
  describeFileMonitorState,
  limitMonitoredDirectories,
} from "./file-panel-status";

export interface FilePanelControllerOptions {
  readonly projectId: string;
  readonly refresh: (directories?: readonly string[]) => Promise<void> | void;
  readonly initialize?: () => Promise<void> | void;
  /** Reports a live-update problem, or undefined once the monitor is healthy. */
  readonly onMonitorIssue?: (issue: string | undefined) => void;
}

export interface FilePanelController {
  updateMonitorDemand(directories?: readonly string[]): Promise<void>;
  requestRefresh(): Promise<void>;
  stop(): void;
}

/** Owns monitor demand and refresh sequencing for the visible files panel. */
export function startFilePanelController({
  projectId,
  refresh,
  initialize,
  onMonitorIssue,
}: FilePanelControllerOptions): FilePanelController {
  let stopped = false;
  const queue = createFilePanelRefreshQueue(refresh);

  const syncMonitor = async (
    directories: readonly string[] = monitoredFileExplorerDirectories(
      projectId,
    ),
  ): Promise<void> => {
    if (stopped) return;
    const limited = limitMonitoredDirectories(directories);
    try {
      const state = await syncProjectMonitor(projectId, limited.directories);
      // Skipped deliveries (superseded or not connected) keep the last status.
      if (stopped || !state) return;
      onMonitorIssue?.(
        describeFileMonitorState(
          state,
          limited.requestedCount,
          limited.directories.length,
        ),
      );
    } catch (error) {
      if (!stopped) onMonitorIssue?.(describeFileMonitorFailure(error));
    }
  };

  const requestRefresh = async (): Promise<void> => {
    if (stopped) return;
    await queue.requestFullRefresh();
  };

  void Promise.resolve(
    initialize ? initialize() : ensureFileExplorerRoot(projectId),
  )
    .catch(() => undefined)
    .then(() => syncMonitor());
  const scheduler = startFileExplorerRefreshScheduler({
    refresh: requestRefresh,
    intervalMs: false,
  });
  const unregisterReconnect = onWorkbenchReconnect(async () => {
    await Promise.all([syncMonitor(), requestRefresh()]);
  });
  const unregisterEvents = registerFileExplorerEventHandler(
    projectId,
    (change) => {
      void queue.accept(change);
    },
  );

  return {
    updateMonitorDemand: syncMonitor,
    requestRefresh,
    stop() {
      if (stopped) return;
      stopped = true;
      unregisterEvents();
      unregisterReconnect();
      scheduler.stop();
      queue.stop();
      void clearProjectMonitor(projectId);
    },
  };
}
