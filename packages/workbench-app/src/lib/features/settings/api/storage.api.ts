import type {
  StorageCleanupRequest,
  StorageCleanupResponse,
  StorageUsageResponse,
} from "$lib/api";
import { protocolRequest } from "$lib/core/protocol/http-client";

export async function getStorageUsage(): Promise<StorageUsageResponse> {
  return (await protocolRequest<StorageUsageResponse>("storage.usage.get", {}))
    .result;
}

export async function runStorageCleanup(
  body: StorageCleanupRequest,
): Promise<StorageCleanupResponse> {
  return (
    await protocolRequest<StorageCleanupResponse>("storage.cleanup", body)
  ).result;
}
