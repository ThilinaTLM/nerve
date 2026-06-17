import { workbenchSelectors } from "$lib/stores/workbench/selectors.svelte";

export const processSelectors = {
  get processes() {
    return workbenchSelectors.processes;
  },
  get scopedProcesses() {
    return workbenchSelectors.scopedProcesses;
  },
  get selectedProcess() {
    return workbenchSelectors.selectedProcess;
  },
  get activeCenterProcess() {
    return workbenchSelectors.activeCenterProcess;
  },
  get processLogs() {
    return workbenchSelectors.processLogs;
  },
};
