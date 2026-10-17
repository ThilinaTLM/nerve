import type { UpgradeReport } from "@nervekit/contracts/status";

/** A notice disappears only after its dismissal was persisted by the server. */
export async function dismissVisibleUpgradeReports(
  state: { reports: UpgradeReport[] },
  dismiss: (step: string) => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  await Promise.all(
    state.reports.map(async ({ step }) => {
      try {
        await dismiss(step);
        state.reports = state.reports.filter((report) => report.step !== step);
      } catch (error) {
        onError(error);
      }
    }),
  );
}
