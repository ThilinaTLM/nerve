import { onWorkbenchReconnect } from "$lib/application/events/workbench-event-bus";
export const logRefreshState = $state({ request: 0 });

export function requestLogsRefresh(): void {
  logRefreshState.request += 1;
}

onWorkbenchReconnect(requestLogsRefresh);
