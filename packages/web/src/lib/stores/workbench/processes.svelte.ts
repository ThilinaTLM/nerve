import { notify } from "$lib/notifications/notify.svelte";
import {
  deleteProcess,
  getProcessLogs,
  pruneProcesses,
  restartProcess,
  startProcess,
  stopProcess,
} from "../../api";
import { loadWorkspaceState } from "../workspace.svelte";
import {
  activateFallbackCenterTab,
  removeCenterTab,
  replaceCenterTab,
} from "./center-tabs.svelte";
import { workbenchState } from "./state.svelte";

export async function selectProcess(processId: string) {
  workbenchState.selectedProcessId = processId;
  workbenchState.processLogs = await getProcessLogs(processId);
}

export async function stopSelectedProcess(processId: string) {
  await stopProcess(processId);
  await loadWorkspaceState();
  if (workbenchState.selectedProcessId) {
    workbenchState.processLogs = await getProcessLogs(
      workbenchState.selectedProcessId,
    );
  }
  notify.success("Process stopped");
}

export async function restartSelectedProcess(processId: string) {
  const restarted = await restartProcess(processId);
  replaceCenterTab(
    { kind: "process", id: processId },
    { kind: "process", id: restarted.id },
  );
  workbenchState.selectedProcessId = restarted.id;
  await loadWorkspaceState();
  workbenchState.processLogs = await getProcessLogs(restarted.id);
  notify.success("Process restarted", {
    description: restarted.name ?? restarted.id,
  });
}

function forgetProcess(processId: string) {
  removeCenterTab({ kind: "process", id: processId });
  if (
    workbenchState.activeCenterTab?.kind === "process" &&
    workbenchState.activeCenterTab.id === processId
  ) {
    activateFallbackCenterTab();
  }
  if (workbenchState.selectedProcessId === processId) {
    workbenchState.selectedProcessId = undefined;
    workbenchState.processLogs = undefined;
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
  if (!workbenchState.selectedProcessId) return;
  workbenchState.processLogs = await getProcessLogs(
    workbenchState.selectedProcessId,
  );
}
