import {
  deleteProcess,
  getProcessLogs,
  pruneProcesses,
  restartProcess,
  startProcess,
  stopProcess,
} from "$lib/api";
import { notify } from "$lib/features/notifications/notify.svelte";
import { processState } from "$lib/features/processes/state/process-state.svelte";
import {
  activateFallbackCenterTab,
  removeCenterTab,
  replaceCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { loadWorkspaceState } from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
export async function selectProcess(processId: string) {
  processState.selectedProcessId = processId;
  processState.processLogs = await getProcessLogs(processId);
}

export async function stopSelectedProcess(processId: string) {
  const wasOrphaned =
    processState.processes.find((process) => process.id === processId)
      ?.status === "orphaned";
  await stopProcess(processId);
  await loadWorkspaceState();
  if (processState.selectedProcessId) {
    processState.processLogs = await getProcessLogs(
      processState.selectedProcessId,
    );
  }
  notify.success(
    wasOrphaned ? "Orphaned process cleanup completed" : "Process stopped",
  );
}

export async function restartSelectedProcess(processId: string) {
  const restarted = await restartProcess(processId);
  replaceCenterTab(
    { kind: "process", id: processId },
    { kind: "process", id: restarted.id },
  );
  processState.selectedProcessId = restarted.id;
  await loadWorkspaceState();
  processState.processLogs = await getProcessLogs(restarted.id);
  notify.success("Process restarted", {
    description: restarted.name ?? restarted.id,
  });
}

function forgetProcess(processId: string) {
  removeCenterTab({ kind: "process", id: processId });
  if (
    workspaceState.activeCenterTab?.kind === "process" &&
    workspaceState.activeCenterTab.id === processId
  ) {
    activateFallbackCenterTab();
  }
  if (processState.selectedProcessId === processId) {
    processState.selectedProcessId = undefined;
    processState.processLogs = undefined;
  }
}

export async function removeProcess(processId: string) {
  await deleteProcess(processId);
  forgetProcess(processId);
  await loadWorkspaceState();
  notify.success("Process removed");
}

export async function pruneStoppedProcesses() {
  const { removed } = await pruneProcesses();
  for (const id of removed) forgetProcess(id);
  await loadWorkspaceState();
  notify.success(
    removed.length === 1
      ? "Removed 1 stopped process"
      : `Removed ${removed.length} stopped processes`,
  );
}

export async function runProcessCommand(input: {
  projectId: string;
  cwd: string;
  command: string;
  name?: string;
}) {
  const process = await startProcess(input);
  await loadWorkspaceState();
  await selectProcess(process.id);
  notify.success("Command started", { description: input.command });
  return process;
}

export async function refreshProcessLogs() {
  if (!processState.selectedProcessId) return;
  processState.processLogs = await getProcessLogs(
    processState.selectedProcessId,
  );
}
