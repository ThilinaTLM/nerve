import {
  onEvent,
  type WorkbenchEvent,
} from "$lib/application/events/event-bus";

export type FileExplorerChange = {
  generation: number;
  directories: string[];
  fullRefreshRequired: boolean;
};

function projectChange(
  event: WorkbenchEvent,
  projectId: string,
): FileExplorerChange | undefined {
  if (event.type !== "filesystem.project.changed") return undefined;
  const data = event.data;
  if (
    data?.projectId !== projectId ||
    typeof data.generation !== "number" ||
    !Array.isArray(data.directories) ||
    typeof data.fullRefreshRequired !== "boolean"
  )
    return undefined;
  return {
    generation: data.generation,
    directories: data.directories.filter(
      (path): path is string => typeof path === "string",
    ),
    fullRefreshRequired: data.fullRefreshRequired,
  };
}

export function registerFileExplorerEventHandler(
  projectId: string,
  requestRefresh: (change: FileExplorerChange) => void,
): () => void {
  return onEvent("filesystem.project.changed", (event) => {
    const change = projectChange(event, projectId);
    if (change) requestRefresh(change);
  });
}
