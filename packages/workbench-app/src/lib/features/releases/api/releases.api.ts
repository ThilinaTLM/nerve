import type { LatestRelease } from "@nervekit/contracts/status";
import { protocolRequest } from "@nervekit/protocol";

export async function getLatestRelease(): Promise<LatestRelease> {
  return (await protocolRequest("status.latestRelease.get", {})).result;
}
