import type { ProcessLogQueryResponse, ProcessRecord } from "$lib/api";

export const processState = $state({
  processes: [] as ProcessRecord[],
  selectedProcessId: undefined as string | undefined,
  processLogs: undefined as ProcessLogQueryResponse | undefined,
  openProcessTabIds: [] as string[],
});
