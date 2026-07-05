<script lang="ts">
  import { Boxes, ChevronRight, Plus, RefreshCw, Search } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import TabsBar from "@nervekit/ui/components/ui/tabs-bar";
  import AppShell from "../components/layout/AppShell.svelte";
  import SandboxActionMenu from "../components/SandboxActionMenu.svelte";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import SandboxSummaryCards from "../components/SandboxSummaryCards.svelte";
  import { filteredSandboxes } from "../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import type { SandboxFleetFilter } from "../state/sandbox-status";
  import type { SandboxManagerRouteState } from "./route-state.svelte";

  let { route }: { route: SandboxManagerRouteState } = $props();

  const store = useSandboxManagerStore();
  const sandboxes = $derived(filteredSandboxes(store));

  const filterTabs = [
    { value: "all", label: "All" },
    { value: "running", label: "Running" },
    { value: "degraded", label: "Degraded" },
    { value: "failed", label: "Failed" },
    { value: "stopped", label: "Stopped" },
  ];
  let filter = $state<SandboxFleetFilter>(store.fleetFilter);
  $effect(() => {
    store.fleetFilter = filter;
  });
</script>

<AppShell {route}>
  {#snippet actions()}
    <Button variant="outline" size="sm" onclick={() => void store.refreshFleet()}>
      <RefreshCw class="size-4" /> Refresh
    </Button>
    <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
      <Plus class="size-4" /> New sandbox
    </Button>
  {/snippet}

  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 class="text-lg font-semibold">Sandboxes</h1>
      <p class="text-sm text-muted-foreground">
        Monitor and manage sandbox containers owned by this manager.
      </p>
    </div>

    {#if store.connection !== "live"}
      <div class="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
        <StatusDot tone="running" pulse />
        <span class="capitalize">{store.connection}</span>
        <span>to the sandbox manager…</span>
      </div>
    {/if}

    <SandboxSummaryCards />

    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <TabsBar tabs={filterTabs} bind:value={filter} ariaLabel="Filter sandboxes" />
      </div>
      <div class="relative w-full sm:w-64">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          bind:value={store.searchQuery}
          placeholder="Search sandboxes…"
          class="pl-8"
          aria-label="Search sandboxes"
        />
      </div>
    </div>

    {#if sandboxes.length === 0}
      <div class="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card py-16 text-center">
        <Boxes class="size-8 text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          {store.sandboxes.length === 0
            ? "No sandboxes yet. Create one to get started."
            : "No sandboxes match the current filter."}
        </p>
        {#if store.sandboxes.length === 0}
          <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
            <Plus class="size-4" /> New sandbox
          </Button>
        {/if}
      </div>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each sandboxes as record (record.sandboxId)}
          <li
            class="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-3 text-left"
              onclick={() => route.openSandbox(record.sandboxId)}
            >
              <div class="flex min-w-0 flex-col">
                <span class="truncate text-sm font-medium">
                  {record.name ?? record.sandboxId}
                </span>
                <span class="truncate font-mono text-xs text-muted-foreground">
                  {record.image.reference}
                </span>
              </div>
            </button>
            <div class="flex items-center gap-2">
              <SandboxStatusBadge {record} />
              <SandboxActionMenu {record} compact />
              <ChevronRight class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</AppShell>
