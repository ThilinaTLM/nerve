import type { StorageUsageResponse } from "@nervekit/contracts/storage";
import { protocolRequest } from "@nervekit/protocol/adapters";
export async function getStorageUsage(): Promise<StorageUsageResponse> {
  return (await protocolRequest("storage.usage.get", {})).result;
}
