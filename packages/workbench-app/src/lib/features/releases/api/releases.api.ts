import type { LatestRelease } from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function getLatestRelease(): Promise<LatestRelease> {
  return (await protocolRequest("status.latestRelease.get", {})).result;
}
