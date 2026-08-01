export const logRefreshState = $state({ request: 0 });

export function requestLogsRefresh(): void {
  logRefreshState.request += 1;
}
