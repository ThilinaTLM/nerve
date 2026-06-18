import { getProcessLogs } from "$lib/api";
import { openConversation } from "$lib/features/conversations/state/conversation-flow.svelte";
import { processState } from "$lib/features/processes/state/process-state.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

function addProcessTab(processId: string) {
  addCenterTab({ kind: "process", id: processId });
}

export async function openProcessTab(processId: string) {
  addProcessTab(processId);
  await selectCenterProcessTab(processId);
}

export async function selectCenterConversationTab(conversationId: string) {
  await openConversation(conversationId);
}

export async function selectCenterProcessTab(processId: string) {
  addProcessTab(processId);
  processState.selectedProcessId = processId;
  setActiveCenterTab({ kind: "process", id: processId });
  processState.processLogs = await getProcessLogs(processId);
}

export async function closeProcessTab(processId: string) {
  const tab = { kind: "process" as const, id: processId };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "process" &&
    workspaceState.activeCenterTab.id === processId;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);

  if (processState.selectedProcessId === processId) {
    processState.selectedProcessId = undefined;
    processState.processLogs = undefined;
  }

  if (closingActive) await selectCenterTab(fallback);
}
