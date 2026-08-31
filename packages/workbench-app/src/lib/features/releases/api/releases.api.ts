import type { LatestRelease } from "@nervekit/contracts/status";
import { protocolRequest } from "@nervekit/protocol/adapters";

export async function getLatestRelease(): Promise<LatestRelease> {
  return (await protocolRequest("status.latestRelease.get", {})).result;
}
