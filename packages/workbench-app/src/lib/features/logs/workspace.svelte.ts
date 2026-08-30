import { logsState } from "./state/log-state.svelte";

export const logWorkspaceReadModel = {
  get tabOpen() {
    return logsState.logsTabOpen;
  },
};

export function setLogWorkspaceTabOpen(open: boolean): void {
  logsState.logsTabOpen = open;
}
