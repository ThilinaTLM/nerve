import type { LaunchRecord } from "@nervekit/contracts/launches";

type LaunchIdentity = Pick<
  LaunchRecord,
  "id" | "projectId" | "definitionId" | "restartRootLaunchId"
>;

/** Portable definition IDs are only unique within their owning project. */
export function launchEntryIdentity(launch: LaunchIdentity): string {
  return launch.definitionId && launch.projectId
    ? `definition:${encodeURIComponent(launch.projectId)}:${encodeURIComponent(launch.definitionId)}`
    : (launch.restartRootLaunchId ?? launch.id);
}

/** Restored definition tabs must match both their key and owning project. */
export function restoredLaunchEntryExists(
  entryId: string,
  projectId: string | undefined,
  launches: readonly LaunchIdentity[],
): boolean {
  return launches.some(
    (launch) =>
      launchEntryIdentity(launch) === entryId &&
      (!entryId.startsWith("definition:") || launch.projectId === projectId),
  );
}
