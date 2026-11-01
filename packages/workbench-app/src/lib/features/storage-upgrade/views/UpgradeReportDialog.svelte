<!-- Hosted outside the activity popover; notices only request it. -->
<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { notify } from "$lib/application/notifications/notify.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  dismissUpgradeReports,
  upgradeReportDialog,
  upgradeReportState,
} from "../state/upgrade-report-state.svelte";
import {
  homeRelativePath,
  setAsideGroupLabel,
  upgradeReportLosses,
  upgradeReportSetAsideGroups,
} from "../state/upgrade-report-summary";

let { home }: { home?: string } = $props();

const reports = $derived(upgradeReportState.reports);
const setAside = $derived(upgradeReportSetAsideGroups(reports));
const losses = $derived(upgradeReportLosses(reports));
let examples = $state<Record<string, boolean>>({});

async function copyQuarantinePath(): Promise<void> {
  try {
    await writeClipboardText(`${home}/quarantine`);
    notify.success("Copied quarantine folder path");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

function dismiss(): void {
  upgradeReportDialog.open = false;
  void dismissUpgradeReports();
}
</script>

<Dialog.Root bind:open={upgradeReportDialog.open}>
  <Dialog.Content class="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Upgrade report</Dialog.Title>
      <Dialog.Description>
        Nerve upgraded your data.{setAside.length
          ? " Some items need your attention."
          : ""}
      </Dialog.Description>
    </Dialog.Header>
    <ScrollArea class="max-h-[60vh] min-w-0">
      <div class="grid gap-4 pr-3">
        {#if setAside.length}
          <section class="grid gap-2" aria-label="Set aside">
            <h3 class="text-ui text-muted-foreground">Set aside</h3>
            <ul class="grid gap-3">
              {#each setAside as group (`${group.kind}:${group.reason}`)}
                {@const key = `${group.kind}:${group.reason}`}
                <li class="grid min-w-0 gap-0.5">
                  <p class="text-ui">{setAsideGroupLabel(group)}</p>
                  {#if group.reason}
                    <p class="text-ui break-words text-muted-foreground">
                      {group.reason}
                    </p>
                  {/if}
                  <Collapsible.Root
                    open={examples[key] ?? false}
                    onOpenChange={(open) => (examples[key] = open)}
                  >
                    <Collapsible.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="sm"
                          class="group/disc -ml-1.5 text-muted-foreground"
                        >
                          <ChevronRight
                            class="transition-transform group-aria-expanded/disc:rotate-90"
                            aria-hidden="true"
                          />Show examples
                        </Button>
                      {/snippet}
                    </Collapsible.Trigger>
                    {#if examples[key]}
                      <ul class="grid gap-0.5 border-l pl-2">
                        {#each group.paths as path (path)}
                          <li
                            class="truncate font-mono text-ui text-muted-foreground"
                            title={path}
                          >
                            {homeRelativePath(path, home)}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </Collapsible.Root>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
        {#if losses.length}
          <section class="grid gap-2" aria-label="Adjusted during upgrade">
            <h3 class="text-ui text-muted-foreground">
              Adjusted during upgrade
            </h3>
            <ul class="grid gap-1 text-ui text-muted-foreground">
              {#each losses as loss (loss.reason)}
                <li class="break-words">
                  <span class="tabular-nums">{loss.count}</span> · {loss.reason}
                </li>
              {/each}
            </ul>
          </section>
        {/if}
        {#if home && setAside.length}
          <div>
            <Button
              variant="ghost"
              size="sm"
              class="-ml-1.5 text-muted-foreground"
              onclick={() => void copyQuarantinePath()}
              >Copy quarantine folder path</Button
            >
          </div>
        {/if}
      </div>
    </ScrollArea>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (upgradeReportDialog.open = false)}
        >Close</Button
      >
      <Button onclick={dismiss}>Dismiss notice</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
