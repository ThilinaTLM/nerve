<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import PackageCheck from "@lucide/svelte/icons/package-check";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import ActivityEntry from "$lib/presentation/activity/ActivityEntry.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  dismissUpgradeReports,
  upgradeReportState,
} from "../state/upgrade-report-state.svelte";
import {
  summarizeUpgradeReports,
  upgradeReportHeadline,
  upgradeReportLosses,
  upgradeReportSetAsideGroups,
} from "../state/upgrade-report-summary";

let detailsOpen = $state(false);

const reports = $derived(upgradeReportState.reports);
const summary = $derived(summarizeUpgradeReports(reports));
const headline = $derived(upgradeReportHeadline(reports));
const setAside = $derived(upgradeReportSetAsideGroups(reports));
let { home }: { home?: string } = $props();
const losses = $derived(upgradeReportLosses(reports));

async function copyPath(path: string): Promise<void> {
  try {
    await writeClipboardText(path);
    notify.success("Copied path");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

function dismiss(): void {
  detailsOpen = false;
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
        onclick={() => (detailsOpen = true)}>Details</Button
      >
      <Button
        variant="ghost"
        size="sm"
        class="text-muted-foreground"
        onclick={dismiss}>Dismiss</Button
      >
    {/snippet}
  </ActivityEntry>

  <Dialog.Root bind:open={detailsOpen}>
    <Dialog.Content class="grid-cols-[minmax(0,1fr)] sm:max-w-xl">
      <Dialog.Header>
        <Dialog.Title>Upgrade report</Dialog.Title>
        <Dialog.Description>
          {summary}
          {#if setAside.length}
            Set-aside data is kept in the folders below until you delete it.
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      <ScrollArea class="max-h-[60vh] min-w-0">
        <div class="space-y-4 pr-3">
          {#if home}
            <p class="text-xs text-muted-foreground">
              Reports: <code class="font-mono break-all"
                >{home}/migrations/reports</code
              ><br />Quarantine:
              <code class="font-mono break-all">{home}/quarantine</code>
            </p>
          {/if}
          {#if setAside.length > 0}
            <ul class="divide-y divide-border rounded-md border">
              {#each setAside as item (item.reason)}
                <li class="space-y-1 p-3">
                  <p class="text-sm font-medium break-words">
                    {item.count} × {item.reason}
                  </p>
                  {#each item.paths as path (path)}
                    <div class="flex items-center gap-2">
                      <code
                        class="min-w-0 flex-1 font-mono break-all text-xs text-muted-foreground"
                        title={path}>{path}</code
                      >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy path"
                        onclick={() => void copyPath(path)}
                      >
                        <Copy class="size-3.5" />
                      </Button>
                    </div>
                  {/each}
                </li>
              {/each}
            </ul>
          {/if}
          {#if losses.length > 0}
            <div class="space-y-1">
              <h3 class="text-sm font-semibold">Not fully carried over</h3>
              <ul class="text-xs text-muted-foreground">
                {#each losses as loss (loss.reason)}
                  <li>{loss.count} × {loss.reason}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </ScrollArea>
      <Dialog.Footer>
        <Button variant="ghost" onclick={() => (detailsOpen = false)}
          >Close</Button
        >
        <Button onclick={dismiss}>Dismiss</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
