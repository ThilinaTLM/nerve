import { isPathInDirectory } from "$lib/core/utils/path";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { processState } from "./process-state.svelte";

export const processSelectors = {
  get processes() {
    return processState.processes;
  },
  get scopedProcesses() {
    const projectDir = workspaceSelectors.activeProject?.dir;
    if (!projectDir) return [];
    return processState.processes.filter((process) =>
      isPathInDirectory(process.cwd, projectDir),
    );
  },
  get selectedProcess() {
    return processState.processes.find(
      (process) => process.id === processState.selectedProcessId,
    );
  },
  get activeCenterProcess() {
    const active = workspaceState.activeCenterTab;
    if (active?.kind !== "process") return undefined;
    return processState.processes.find((process) => process.id === active.id);
  },
  get processLogs() {
    return processState.processLogs;
  },
};
