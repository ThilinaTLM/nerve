<script lang="ts">
import type { LaunchRecord } from "@nervekit/contracts/launches";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { PanelList } from "$lib/presentation/panels";
import LaunchRunRow from "./LaunchRunRow.svelte";
import { launchRunLabel } from "./launch-panel-controller.js";
import type {
  LaunchEntryCapabilities,
  LaunchRunEntry,
} from "./launch-panel-types.js";

let {
  open = $bindable(false),
  runs,
  capabilities,
  onOpen,
  onCancel,
  onForceKill,
  onRestart,
  onRerunDefinition,
  onRemove,
  onCopy,
  onSaveAsDefinition,
  onOpenChange,
}: {
  open?: boolean;
  runs: readonly LaunchRunEntry[];
  capabilities: LaunchEntryCapabilities;
  onOpen: (launchId: string) => void;
  onCancel: (launchId: string) => void;
  onForceKill: (launchId: string) => void;
  onRestart: (launchId: string) => void;
  onRerunDefinition: (entry: LaunchRunEntry) => void;
  onRemove: (launchId: string) => void;
  onCopy: (text: string) => void;
  onSaveAsDefinition: (launch: LaunchRecord) => void;
  onOpenChange?: (open: boolean) => void;
} = $props();

let filter = $state("");

const matches = $derived.by(() => {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return runs;
  return runs.filter((entry) =>
    `${launchRunLabel(entry).text} ${entry.run.command}`
      .toLowerCase()
      .includes(needle),
  );
});

$effect(() => {
  if (open) filter = "";
});

function handleOpenChange(next: boolean): void {
  open = next;
  onOpenChange?.(next);
}

function openRun(launchId: string): void {
  onOpen(launchId);
  handleOpenChange(false);
}
</script>

<Dialog
  flush
  bind:open
  size="wide"
  title="Runs"
  description={`${runs.length} launch runs`}
  class="h-[min(40rem,calc(100vh-6rem))]"
  onOpenChange={handleOpenChange}
>
  <div class="flex min-h-0 flex-col">
    <div class="flex shrink-0 items-center border-b border-border/60 p-2">
      <SearchInput
        bind:value={filter}
        class="flex-1"
        placeholder="Filter runs"
        ariaLabel="Filter runs"
      />
    </div>

    <div class="min-h-0 flex-1 p-1">
      {#if matches.length === 0}
        <p class="p-2 text-ui text-muted-foreground">No runs match.</p>
      {:else}
        <ScrollArea class="h-full">
          <PanelList ariaLabel="All runs" class="gap-1">
            {#each matches as entry (entry.key)}
              <LaunchRunRow
                {entry}
                {capabilities}
                onOpen={openRun}
                {onCancel}
                {onForceKill}
                {onRestart}
                onRerunDefinition={() => onRerunDefinition(entry)}
                {onRemove}
                {onCopy}
                {onSaveAsDefinition}
              />
            {/each}
          </PanelList>
        </ScrollArea>
      {/if}
    </div>
  </div>
</Dialog>
