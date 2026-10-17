import {
  upgradeReportListSchema,
  type UpgradeReport,
} from "@nervekit/contracts/status";
import { apiGet, apiPathSegment, apiPost } from "$lib/platform/http/api-client";

export async function listUpgradeReports(): Promise<UpgradeReport[]> {
  const body = await apiGet<unknown>("/api/storage/upgrade-reports");
  return upgradeReportListSchema.parse(body).reports;
}

export async function dismissUpgradeReport(step: string): Promise<void> {
  await apiPost(
    `/api/storage/upgrade-reports/${apiPathSegment(step)}/dismiss`,
    {},
  );
}
