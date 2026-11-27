import type { StorageUsageResponse } from "@nervekit/contracts/storage";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
/** The daemon's last scan, or a new one when `force` is set or none exists. */
export async function getStorageUsage(
  options: { force?: boolean } = {},
): Promise<StorageUsageResponse> {
  return await requestWorkbench(
    "storage.usage.get",
    options.force ? { force: true } : {},
  );
}
