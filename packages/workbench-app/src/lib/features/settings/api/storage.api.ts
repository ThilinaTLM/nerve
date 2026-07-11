import type {
  StorageCleanupCancelResponse,
  StorageCleanupRequest,
  StorageCleanupStartResponse,
  StorageCleanupStatusResponse,
  StorageUsageResponse,
} from "$lib/api";
import { protocolRequest } from "@nervekit/protocol";

export async function getStorageUsage(): Promise<StorageUsageResponse> {
  return (await protocolRequest("storage.usage.get", {})).result;
}

export async function startStorageCleanup(
  body: StorageCleanupRequest,
): Promise<StorageCleanupStartResponse> {
  return (await protocolRequest("storage.cleanup", body)).result;
}

export async function getStorageCleanup(
  operationId?: string,
): Promise<StorageCleanupStatusResponse> {
  return (
    await protocolRequest("storage.cleanup.get", {
      ...(operationId ? { operationId } : {}),
    })
  ).result;
}

export async function cancelStorageCleanup(
  operationId: string,
): Promise<StorageCleanupCancelResponse> {
  return (
    await protocolRequest("storage.cleanup.cancel", {
      operationId,
    })
  ).result;
}
