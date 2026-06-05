import { getProcessLogs } from "../../api";
import { openSession } from "../session-flow.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "./center-tabs.svelte";
import { workbenchState } from "./state.svelte";

function addProcessTab(processId: string) {
  addCenterTab({ kind: "process", id: processId });
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
  setActiveCenterTab({ kind: "process", id: processId });
  workbenchState.processLogs = await getProcessLogs(processId);
}

export async function closeProcessTab(processId: string) {
  const tab = { kind: "process" as const, id: processId };
  const closingActive =
    workbenchState.activeCenterTab?.kind === "process" &&
    workbenchState.activeCenterTab.id === processId;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);

  if (workbenchState.selectedProcessId === processId) {
    workbenchState.selectedProcessId = undefined;
    workbenchState.processLogs = undefined;
  }

  if (closingActive) await selectCenterTab(fallback);
}
