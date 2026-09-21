import { RefreshCoordinator } from "$lib/application/refresh/refresh-coordinator";
import type { FileExplorerChange } from "./file-explorer-events";

type RefreshDemand = FileExplorerChange & { forced: boolean };

export interface FilePanelRefreshQueue {
  accept(change: FileExplorerChange): Promise<void>;
  requestFullRefresh(): Promise<void>;
  stop(): void;
}

/** Serializes monitor events and explicit user refreshes for a files panel. */
export function createFilePanelRefreshQueue(
  refresh: (directories?: readonly string[]) => Promise<void> | void,
): FilePanelRefreshQueue {
  let observedGeneration = -1;
  const coordinator = new RefreshCoordinator<RefreshDemand>({
    merge: (current, next) => ({
      generation: Math.max(current?.generation ?? -1, next.generation),
      forced: (current?.forced ?? false) || next.forced,
      fullRefreshRequired:
        (current?.fullRefreshRequired ?? false) || next.fullRefreshRequired,
      directories: [
        ...new Set([...(current?.directories ?? []), ...next.directories]),
      ],
    }),
    execute: async (demand) => {
      if (!demand.forced && demand.generation <= observedGeneration) return;
      observedGeneration = Math.max(observedGeneration, demand.generation);
      await refresh(
        demand.fullRefreshRequired ? undefined : demand.directories,
      );
    },
  });

  return {
    accept: (change) => coordinator.request({ ...change, forced: false }),
    requestFullRefresh: () =>
      coordinator.request({
        generation: -1,
        directories: [],
        fullRefreshRequired: true,
        forced: true,
      }),
    stop: () => coordinator.stop(),
  };
}
