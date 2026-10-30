import type { UpgradeReport } from "@nervekit/contracts/status";
import { clientLog } from "$lib/platform/logging/client-logger";
import {
  dismissUpgradeReport,
  listUpgradeReports,
} from "../api/upgrade-reports.api";

import { dismissVisibleUpgradeReports } from "./upgrade-report-dismissal";

export const upgradeReportState = $state({
  reports: [] as UpgradeReport[],
  loaded: false,
});

/** Fetches unseen reports once per page load; failures never surface. */
export async function loadUpgradeReports(): Promise<void> {
  if (upgradeReportState.loaded) return;
  upgradeReportState.loaded = true;
  try {
    upgradeReportState.reports = await listUpgradeReports();
  } catch (error) {
    clientLog("warn", "storage-upgrade", "Upgrade report fetch failed", {
      error,
    });
  }
}

export async function dismissUpgradeReports(): Promise<void> {
  await dismissVisibleUpgradeReports(
    upgradeReportState,
    dismissUpgradeReport,
    (error) =>
      clientLog("warn", "storage-upgrade", "Upgrade report dismiss failed", {
        error,
      }),
  );
}

export function hasUpgradeReports(): boolean {
  return upgradeReportState.reports.length > 0;
}

/** The details dialog is hosted outside the activity popover; the notice only requests it. */
export const upgradeReportDialog = $state({ open: false });
