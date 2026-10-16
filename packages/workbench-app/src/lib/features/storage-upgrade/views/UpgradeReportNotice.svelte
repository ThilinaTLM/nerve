<script lang="ts">
import { onMount } from "svelte";
import Copy from "@lucide/svelte/icons/copy";
import PackageCheck from "@lucide/svelte/icons/package-check";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  dismissUpgradeReports,
  loadUpgradeReports,
  upgradeReportState,
} from "../state/upgrade-report-state.svelte";
import {
  summarizeUpgradeReports,
  upgradeReportLosses,
  upgradeReportSetAside,
} from "../state/upgrade-report-summary";

let detailsOpen = $state(false);

const reports = $derived(upgradeReportState.reports);
const summary = $derived(summarizeUpgradeReports(reports));
const setAside = $derived(upgradeReportSetAside(reports));
const losses = $derived(upgradeReportLosses(reports));

onMount(() => void loadUpgradeReports());

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
  <aside
    class="fixed right-4 bottom-10 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
    aria-live="polite"
    aria-label="Upgrade report"
  >
    <div class="flex gap-3">
      <div
        class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
      >
        <PackageCheck class="size-4" strokeWidth={2} />
      </div>
      <div class="min-w-0 flex-1 space-y-3">
        <p class="text-sm">{summary}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onclick={dismiss}>Dismiss</Button>
          <Button onclick={() => (detailsOpen = true)}>Details</Button>
        </div>
      </div>
    </div>
  </aside>

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
          {#if setAside.length > 0}
            <ul class="divide-y divide-border rounded-md border">
              {#each setAside as item (item.quarantinePath)}
                <li class="space-y-1 p-3">
                  <p class="text-sm font-medium break-words">
                    {item.title ?? item.id}
                  </p>
                  <p class="text-xs text-muted-foreground">{item.reason}</p>
                  <div class="flex items-center gap-2">
                    <code
                      class="min-w-0 flex-1 font-mono break-all text-xs text-muted-foreground"
                      title={item.quarantinePath}>{item.quarantinePath}</code
                    >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copy path"
                      onclick={() => void copyPath(item.quarantinePath)}
                    >
                      <Copy class="size-3.5" />
                    </Button>
                  </div>
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
