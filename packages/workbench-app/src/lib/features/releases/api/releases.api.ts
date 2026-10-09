import type { LatestRelease } from "@nervekit/contracts/status";
import { protocolRequest } from "$lib/application/startup/workbench-connection";

export async function getLatestRelease(): Promise<LatestRelease> {
  return (await protocolRequest("status.latestRelease.get", {})).result;
}
