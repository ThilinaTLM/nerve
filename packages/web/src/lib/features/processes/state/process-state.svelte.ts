import { workbenchState } from "$lib/stores/workbench/state.svelte";

/** Compatibility facade for process-owned state during migration. */
export const processState = {
  get processes() {
    return workbenchState.processes;
  },
  set processes(value) {
    workbenchState.processes = value;
  },
  get selectedProcessId() {
    return workbenchState.selectedProcessId;
  },
  set selectedProcessId(value) {
    workbenchState.selectedProcessId = value;
  },
  get processLogs() {
    return workbenchState.processLogs;
  },
  set processLogs(value) {
    workbenchState.processLogs = value;
  },
  get openProcessTabIds() {
    return workbenchState.openProcessTabIds;
  },
  set openProcessTabIds(value) {
    workbenchState.openProcessTabIds = value;
  },
};
