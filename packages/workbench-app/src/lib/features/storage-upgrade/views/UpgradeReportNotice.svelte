<script lang="ts">
import PackageCheck from "@lucide/svelte/icons/package-check";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ActivityEntry from "$lib/presentation/activity/ActivityEntry.svelte";
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
  <ActivityEntry
    title={headline.title}
    description={headline.description}
    titleHint={summary}
  >
    {#snippet icon()}
      <PackageCheck
        class="size-4 {headline.title === 'Upgrade finished'
          ? 'text-success'
          : 'text-warning'}"
        aria-hidden="true"
      />
    {/snippet}
    {#snippet footer()}
      <Button
        variant="ghost"
        size="sm"
        class="text-muted-foreground"
        onclick={onDetails}>Details</Button
      >
      <Button
        variant="ghost"
        size="sm"
        class="text-muted-foreground"
        onclick={dismiss}>Dismiss</Button
      >
    {/snippet}
  </ActivityEntry>
{/if}
