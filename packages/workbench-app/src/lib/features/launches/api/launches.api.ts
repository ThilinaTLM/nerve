import type {
  CancelLaunchRequest,
  StartLaunchRequest,
  LaunchLogQuery,
  LaunchLogQueryResponse,
  LaunchPortConflictListener,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import type { OperationResult } from "@nervekit/contracts/operations";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export async function getLaunchLogs(
  launchId: string,
  query: LaunchLogQuery = {},
): Promise<LaunchLogQueryResponse> {
  return await requestWorkbench("launch.logs", { launchId, ...query });
}

export async function startLaunch(
  body: StartLaunchRequest,
): Promise<LaunchRecord> {
  return (await requestWorkbench("launch.start", body)).launch;
}

export async function startLaunchDefinition(
  definitionId: string,
  terminateListeners?: LaunchPortConflictListener[],
): Promise<OperationResult<"launch.startDefinition">> {
  return await requestWorkbench("launch.startDefinition", {
    definitionId,
    terminateListeners,
  });
}

export async function cancelLaunch(
  launchId: string,
  request: CancelLaunchRequest = {},
): Promise<LaunchRecord> {
  return (await requestWorkbench("launch.cancel", { launchId, ...request }))
    .launch;
}

export async function restartLaunch(launchId: string): Promise<LaunchRecord> {
  return (
    await requestWorkbench("launch.restart", {
      launchId,
    })
  ).launch;
}

export async function deleteLaunch(launchId: string): Promise<void> {
  await requestWorkbench("launch.delete", { launchId });
}

export async function pruneLaunches(): Promise<{ removed: string[] }> {
  return await requestWorkbench("launch.prune", {});
}
