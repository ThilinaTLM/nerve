import type {
  StorageCleanupRequest,
  StorageCleanupResponse,
  StorageUsageResponse,
} from "$lib/api";
import { apiGet, apiPost } from "$lib/core/api/client";

export function getStorageUsage(): Promise<StorageUsageResponse> {
  return apiGet<StorageUsageResponse>("/api/storage/usage");
}

export function runStorageCleanup(
  body: StorageCleanupRequest,
): Promise<StorageCleanupResponse> {
  return apiPost<StorageCleanupResponse>("/api/storage/cleanup", body);
}
