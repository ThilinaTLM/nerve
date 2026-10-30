<script lang="ts">
import NotificationEntry from "$lib/presentation/activity/NotificationEntry.svelte";
import {
  dismissUpgradeReports,
  upgradeReportState,
} from "../state/upgrade-report-state.svelte";
import {
  summarizeUpgradeReports,
  upgradeReportHeadline,
} from "../state/upgrade-report-summary";

const reports = $derived(upgradeReportState.reports);
const summary = $derived(summarizeUpgradeReports(reports));
const headline = $derived(upgradeReportHeadline(reports));
/** Opens the details dialog; the host closes the popover first. */
let { onDetails }: { onDetails: () => void } = $props();

function dismiss(): void {
  void dismissUpgradeReports();
}
</script>

{#if reports.length > 0}
  <NotificationEntry
    tone={headline.title === "Upgrade finished" ? "succeeded" : "warning"}
    title={headline.title}
    context={headline.description}
    titleHint={summary}
    actions={[{ label: "Details", onSelect: onDetails }]}
    onDismiss={dismiss}
  />
{/if}
