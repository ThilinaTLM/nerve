import type {
  ProcessLogQueryResponse,
  ProcessRecord,
  StartProcessRequest,
} from "@nerve/shared";
import {
  apiDelete,
  apiGet,
  apiPathSegment,
  apiPost,
} from "../../../core/api/client";

export async function getProcessLogs(
  processId: string,
  mode = "recent",
): Promise<ProcessLogQueryResponse> {
  const params = new URLSearchParams({ mode, limit: "120" });
  return apiGet<ProcessLogQueryResponse>(
    `/api/processes/${apiPathSegment(processId)}/logs?${params.toString()}`,
  );
}

export async function startProcess(
  body: StartProcessRequest,
): Promise<ProcessRecord> {
  return (await apiPost<{ process: ProcessRecord }>("/api/processes", body))
    .process;
}

export async function stopProcess(processId: string): Promise<ProcessRecord> {
  return (
    await apiPost<{ process: ProcessRecord }>(
      `/api/processes/${apiPathSegment(processId)}/stop`,
      {},
    )
  ).process;
}

export async function restartProcess(
  processId: string,
): Promise<ProcessRecord> {
  return (
    await apiPost<{ process: ProcessRecord }>(
      `/api/processes/${apiPathSegment(processId)}/restart`,
      {},
    )
  ).process;
}

export async function deleteProcess(processId: string): Promise<void> {
  await apiDelete<{ removed: boolean }>(
    `/api/processes/${apiPathSegment(processId)}`,
  );
}

export async function pruneProcesses(): Promise<{ removed: string[] }> {
  return apiPost<{ removed: string[] }>("/api/processes/prune", {});
}
