import type { StorageUsageResponse } from "@nervekit/contracts/storage";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
export async function getStorageUsage(): Promise<StorageUsageResponse> {
  return await requestWorkbench("storage.usage.get", {});
}
