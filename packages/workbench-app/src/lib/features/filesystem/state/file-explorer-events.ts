import { onEvent, type WorkbenchEvent } from "$lib/core/events/event-bus";

function changedProjectId(event: WorkbenchEvent): string | undefined {
  if (event.type !== "filesystem.project.changed") return undefined;
  const projectId = event.data?.projectId;
  const source = event.data?.source;
  return typeof projectId === "string" &&
    projectId.startsWith("proj_") &&
    source === "filesystem"
    ? projectId
    : undefined;
}

export function registerFileExplorerEventHandler(
  projectId: string,
  requestRefresh: () => void,
): () => void {
  return onEvent("filesystem.project.changed", (event) => {
    if (changedProjectId(event) === projectId) requestRefresh();
  });
}
