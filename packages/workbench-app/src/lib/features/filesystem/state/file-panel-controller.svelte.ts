import { ensureFileExplorerRoot } from "./file-explorer-actions.svelte";
import { registerFileExplorerEventHandler } from "./file-explorer-events";
import { startFileExplorerRefreshScheduler } from "./file-explorer-refresh-scheduler";

export interface FilePanelControllerOptions {
  readonly projectId: string;
  readonly refresh: () => Promise<void> | void;
  readonly initialize?: () => Promise<void> | void;
}

/** Owns filesystem event/scheduler lifetimes for the visible files panel. */
export function startFilePanelController({
  projectId,
  refresh,
  initialize,
}: FilePanelControllerOptions): () => void {
  void (initialize ? initialize() : ensureFileExplorerRoot(projectId));
  const scheduler = startFileExplorerRefreshScheduler({ refresh });
  const unregisterEvents = registerFileExplorerEventHandler(
    projectId,
    scheduler.requestRefresh,
  );
  return () => {
    unregisterEvents();
    scheduler.stop();
  };
}
