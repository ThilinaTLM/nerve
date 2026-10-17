import {
  launchDefinitionSchema,
  type LaunchDefinitionCatalog,
  type LaunchCatalogEntryRef,
  type LaunchDefinition,
  type CreateLaunchDefinitionRequest,
  type UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import type {
  CancelLaunchRequest,
  StartLaunchRequest,
  LaunchLogQuery,
  LaunchLogQueryResponse,
  LaunchPortConflictListener,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import type { OperationResult } from "@nervekit/contracts/operations";
import {
  requestWorkbench,
  protocolRequest as workbenchRequest,
} from "$lib/application/startup/workbench-connection";

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
  projectId: string,
  definitionId: string,
  terminateListeners?: LaunchPortConflictListener[],
): Promise<OperationResult<"launch.startDefinition">> {
  return await requestWorkbench("launch.startDefinition", {
    projectId,
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

export async function getLaunchCatalog(
  projectId: string,
): Promise<LaunchDefinitionCatalog> {
  return (await workbenchRequest("launchDefinition.list", { projectId })).result
    .catalog;
}
export async function createLaunchDefinition(
  projectId: string,
  body: CreateLaunchDefinitionRequest,
  expectedRevision: string,
): Promise<LaunchDefinition> {
  return launchDefinitionSchema.parse(
    (
      await workbenchRequest("launchDefinition.create", {
        projectId,
        ...body,
        expectedRevision,
      })
    ).result.definition,
  );
}
export async function updateLaunchDefinition(
  projectId: string,
  definitionId: string,
  body: UpdateLaunchDefinitionRequest,
  expectedRevision: string,
): Promise<LaunchDefinition> {
  return launchDefinitionSchema.parse(
    (
      await workbenchRequest("launchDefinition.update", {
        projectId,
        definitionId,
        ...body,
        expectedRevision,
      })
    ).result.definition,
  );
}
export async function deleteLaunchDefinition(
  projectId: string,
  definitionId: string,
  expectedRevision: string,
): Promise<void> {
  await workbenchRequest("launchDefinition.delete", {
    projectId,
    definitionId,
    expectedRevision,
  });
}
export async function createLaunchFolder(
  projectId: string,
  input: { label: string; parentFolderId: string | null },
  expectedRevision: string,
): Promise<void> {
  await workbenchRequest("launchFolder.create", {
    projectId,
    ...input,
    expectedRevision,
  });
}
export async function renameLaunchFolder(
  projectId: string,
  folderId: string,
  label: string,
  expectedRevision: string,
): Promise<void> {
  await workbenchRequest("launchFolder.rename", {
    projectId,
    folderId,
    label,
    expectedRevision,
  });
}
export async function deleteLaunchFolder(
  projectId: string,
  folderId: string,
  expectedRevision: string,
): Promise<void> {
  await workbenchRequest("launchFolder.delete", {
    projectId,
    folderId,
    expectedRevision,
  });
}
export async function moveLaunchCatalogEntry(
  projectId: string,
  input: {
    entry: LaunchCatalogEntryRef;
    destinationFolderId: string | null;
    beforeSibling: LaunchCatalogEntryRef | null;
  },
  expectedRevision: string,
): Promise<void> {
  await workbenchRequest("launchCatalog.move", {
    projectId,
    ...input,
    expectedRevision,
  });
}
