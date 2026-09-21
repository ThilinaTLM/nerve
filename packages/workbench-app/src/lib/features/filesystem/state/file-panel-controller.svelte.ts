import { clearProjectMonitor, syncProjectMonitor } from "../api/filesystem.api";
import {
  ensureFileExplorerRoot,
  monitoredFileExplorerDirectories,
} from "./file-explorer-actions.svelte";
import { registerFileExplorerEventHandler } from "./file-explorer-events";
import { createFilePanelRefreshQueue } from "./file-panel-refresh-queue";
import { startFileExplorerRefreshScheduler } from "./file-explorer-refresh-scheduler";

export interface FilePanelControllerOptions {
  readonly projectId: string;
  readonly refresh: (directories?: readonly string[]) => Promise<void> | void;
  readonly initialize?: () => Promise<void> | void;
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
}: FilePanelControllerOptions): FilePanelController {
  let stopped = false;
  const queue = createFilePanelRefreshQueue(refresh);

  const requestRefresh = async (): Promise<void> => {
    if (stopped) return;
    await queue.requestFullRefresh();
  };

  void Promise.resolve(
    initialize ? initialize() : ensureFileExplorerRoot(projectId),
  )
    .then(() =>
      syncProjectMonitor(
        projectId,
        monitoredFileExplorerDirectories(projectId),
      ),
    )
    .catch(() => undefined);
  const scheduler = startFileExplorerRefreshScheduler({
    refresh: requestRefresh,
    intervalMs: false,
  });
  const unregisterEvents = registerFileExplorerEventHandler(
    projectId,
    (change) => {
      void queue.accept(change);
    },
  );

  return {
    async updateMonitorDemand(
      directories = monitoredFileExplorerDirectories(projectId),
    ) {
      if (stopped) return;
      await syncProjectMonitor(projectId, [...directories]).catch(
        () => undefined,
      );
    },
    requestRefresh,
    stop() {
      if (stopped) return;
      stopped = true;
      unregisterEvents();
      scheduler.stop();
      queue.stop();
      void clearProjectMonitor(projectId);
    },
  };
}
