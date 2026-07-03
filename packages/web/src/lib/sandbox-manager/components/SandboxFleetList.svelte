<script lang="ts">
  import { Search } from "@lucide/svelte";
  import { Input } from "$lib/components/ui/input";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import TabsBar from "$lib/components/ui/tabs-bar";
  import { cn } from "$lib/core/utils.js";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import {
    activeRunCount,
    filteredSandboxes,
    pendingWaitCount,
  } from "../state/sandbox-manager-selectors.svelte";
  import type { SandboxFleetFilter } from "../state/sandbox-status";
  import DisconnectCountdown from "./DisconnectCountdown.svelte";
  import RuntimeBackendBadge from "./RuntimeBackendBadge.svelte";
  import SandboxStatusBadge from "./SandboxStatusBadge.svelte";

  let { onselect }: { onselect?: () => void } = $props();

  const store = useSandboxManagerStore();
  const records = $derived(filteredSandboxes(store));

  const filterTabs: { value: SandboxFleetFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "running", label: "Running" },
    { value: "degraded", label: "Degraded" },
    { value: "failed", label: "Failed" },
    { value: "stopped", label: "Stopped" },
  ];

  function select(sandboxId: string) {
    void store.selectSandbox(sandboxId);
    onselect?.();
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex flex-col gap-2 border-b p-3">
    <div class="relative">
      <Search
        class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        class="pl-8"
        placeholder="Search name, id, image, label"
        bind:value={store.searchQuery}
        ariaLabel="Search sandboxes"
      />
    </div>
    <TabsBar
      tabs={filterTabs}
      value={store.fleetFilter}
      ariaLabel="Fleet filters"
      onValueChange={(value) => (store.fleetFilter = value as SandboxFleetFilter)}
    />
  </div>

  <ScrollArea class="min-h-0 flex-1">
    {#if records.length === 0}
      <p class="p-4 text-sm text-muted-foreground">
        {store.loadingFleet ? "Loading sandboxes…" : "No sandboxes match."}
      </p>
    {:else}
      <ul class="flex flex-col p-2">
        {#each records as record (record.sandboxId)}
          {@const waits = pendingWaitCount(store, record.sandboxId)}
          {@const runs = activeRunCount(store, record.sandboxId)}
          {@const detail = store.details[record.sandboxId]}
          <li>
            <button
              type="button"
              onclick={() => select(record.sandboxId)}
              class={cn(
                "flex w-full flex-col gap-1.5 rounded-md border border-transparent p-2.5 text-left transition-colors hover:bg-muted",
                store.selectedSandboxId === record.sandboxId &&
                  "border-border bg-muted",
              )}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium">
                  {record.name ?? record.sandboxId}
                </span>
                <SandboxStatusBadge {record} />
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <RuntimeBackendBadge backend={record.backend} />
                <span class="truncate font-mono text-xs text-muted-foreground">
                  {record.image.reference}
                </span>
              </div>
              <div class="flex items-center gap-3 text-xs text-muted-foreground">
                {#if runs > 0}<span>{runs} active</span>{/if}
                {#if waits > 0}<span class="text-warning">{waits} waiting</span>{/if}
                {#if detail?.disconnectExitAt}
                  <DisconnectCountdown exitAt={detail.disconnectExitAt} />
                {/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </ScrollArea>
</div>
