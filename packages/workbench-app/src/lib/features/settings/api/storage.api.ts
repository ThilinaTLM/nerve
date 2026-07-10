import type {
  StorageCleanupCancelResponse,
  StorageCleanupRequest,
  StorageCleanupStartResponse,
  StorageCleanupStatusResponse,
  StorageUsageResponse,
} from "$lib/api";
import { protocolRequest } from "$lib/core/protocol/http-client";

export async function getStorageUsage(): Promise<StorageUsageResponse> {
  return (await protocolRequest<StorageUsageResponse>("storage.usage.get", {}))
    .result;
}

export async function startStorageCleanup(
  body: StorageCleanupRequest,
): Promise<StorageCleanupStartResponse> {
  return (
    await protocolRequest<StorageCleanupStartResponse>("storage.cleanup", body)
  ).result;
}

export async function getStorageCleanup(
  operationId?: string,
): Promise<StorageCleanupStatusResponse> {
  return (
    await protocolRequest<StorageCleanupStatusResponse>("storage.cleanup.get", {
      ...(operationId ? { operationId } : {}),
    })
  ).result;
}

export async function cancelStorageCleanup(
  operationId: string,
): Promise<StorageCleanupCancelResponse> {
  return (
    await protocolRequest<StorageCleanupCancelResponse>(
      "storage.cleanup.cancel",
      {
        operationId,
      },
    )
  ).result;
}
