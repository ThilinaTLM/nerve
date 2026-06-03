import { toast } from "svelte-sonner";
import { getProcessLogs, restartProcess, stopProcess } from "../../api";
import { loadWorkspaceState } from "../workspace.svelte";
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
  toast.success("Process stopped");
}

export async function restartSelectedProcess(processId: string) {
  const restarted = await restartProcess(processId);
  workbenchState.openProcessTabIds = [
    ...new Set(
      workbenchState.openProcessTabIds.map((id) =>
        id === processId ? restarted.id : id,
      ),
    ),
  ];
  if (
    workbenchState.activeCenterTab?.kind === "process" &&
    workbenchState.activeCenterTab.id === processId
  ) {
    workbenchState.activeCenterTab = { kind: "process", id: restarted.id };
  }
  workbenchState.selectedProcessId = restarted.id;
  await loadWorkspaceState();
  workbenchState.processLogs = await getProcessLogs(restarted.id);
  toast.success("Process restarted", {
    description: restarted.name ?? restarted.id,
  });
}

export async function refreshProcessLogs() {
  if (!workbenchState.selectedProcessId) return;
  workbenchState.processLogs = await getProcessLogs(
    workbenchState.selectedProcessId,
  );
}
