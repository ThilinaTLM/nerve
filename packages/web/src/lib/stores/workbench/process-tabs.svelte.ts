import { getProcessLogs } from "../../api";
import { openSession } from "../session-flow.svelte";
import { workbenchState } from "./state.svelte";

function addProcessTab(processId: string) {
  if (!workbenchState.openProcessTabIds.includes(processId)) {
    workbenchState.openProcessTabIds = [
      ...workbenchState.openProcessTabIds,
      processId,
    ];
  }
}

export async function openProcessTab(processId: string) {
  addProcessTab(processId);
  await selectCenterProcessTab(processId);
}

export async function selectCenterConversationTab(sessionId: string) {
  await openSession(sessionId);
}

export async function selectCenterProcessTab(processId: string) {
  addProcessTab(processId);
  workbenchState.selectedProcessId = processId;
  workbenchState.activeCenterTab = { kind: "process", id: processId };
  workbenchState.processLogs = await getProcessLogs(processId);
}

export async function closeProcessTab(processId: string) {
  const currentIds = workbenchState.openProcessTabIds;
  const closingIndex = currentIds.indexOf(processId);
  if (closingIndex === -1) return;

  workbenchState.openProcessTabIds = currentIds.filter(
    (id) => id !== processId,
  );
  const closingActive =
    workbenchState.activeCenterTab?.kind === "process" &&
    workbenchState.activeCenterTab.id === processId;

  if (!closingActive) return;

  const nextProcessId =
    workbenchState.openProcessTabIds[closingIndex] ??
    workbenchState.openProcessTabIds[closingIndex - 1];
  if (nextProcessId) {
    await selectCenterProcessTab(nextProcessId);
    return;
  }

  const nextSessionId =
    workbenchState.activeConversationTabId ??
    workbenchState.openConversationTabIds[0];
  if (nextSessionId) {
    await openSession(nextSessionId);
    return;
  }

  workbenchState.activeCenterTab = undefined;
  workbenchState.selectedProcessId = undefined;
  workbenchState.processLogs = undefined;
}
