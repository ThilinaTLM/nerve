import { getProcessLogs } from "$lib/api";
import { onEvent } from "$lib/core/events/event-bus";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { processState } from "./process-state.svelte";

export function registerProcessEventHandlers(): () => void {
  return onEvent("process.log", handleProcessLogEvent);
}

function handleProcessLogEvent(event: {
  data?: Record<string, unknown>;
}): void {
  const processId = String(event.data?.processId ?? "");
  const viewingProcess =
    workspaceState.activeCenterTab?.kind === "process" &&
    workspaceState.activeCenterTab.id === processId;
  if (
    processId &&
    processId === processState.selectedProcessId &&
    viewingProcess
  ) {
    void getProcessLogs(processId).then((logs) => {
      processState.processLogs = logs;
    });
  }
}
