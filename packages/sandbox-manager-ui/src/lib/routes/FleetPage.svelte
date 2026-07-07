<script lang="ts">
  import { Boxes, LayoutGrid, List, Plus, RefreshCw, Search } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import TabsBar from "@nervekit/ui/components/ui/tabs-bar";
  import AppShell from "../components/layout/AppShell.svelte";
  import SandboxListRow from "../components/SandboxListRow.svelte";
  import SandboxSummaryCards from "../components/SandboxSummaryCards.svelte";
  import SandboxTile from "../components/SandboxTile.svelte";
  import { activityFor, filteredSandboxes } from "../state/sandbox-manager-selectors.svelte";
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

  const VIEW_KEY = "nerve.sandboxManager.fleetView";
  type FleetView = "board" | "list";
  function readView(): FleetView {
    if (typeof localStorage === "undefined") return "board";
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board";
  }
  let view = $state<FleetView>(readView());
  function setView(next: FleetView): void {
    view = next;
    if (typeof localStorage !== "undefined") localStorage.setItem(VIEW_KEY, next);
  }
</script>

<AppShell
  {route}
  title="Sandboxes"
  subtitle="Monitor and manage sandbox containers owned by this manager."
>
  {#snippet actions()}
    <div
      class="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5"
      role="group"
      aria-label="View"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        active={view === "board"}
        ariaLabel="Board view"
        title="Board view"
        onclick={() => setView("board")}
      >
        <LayoutGrid class="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        active={view === "list"}
        ariaLabel="List view"
        title="List view"
        onclick={() => setView("list")}
      >
        <List class="size-4" />
      </Button>
    </div>
    <Button variant="outline" size="sm" onclick={() => void store.refreshFleet()}>
      <RefreshCw class="size-4" /> Refresh
    </Button>
    <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
      <Plus class="size-4" /> New sandbox
    </Button>
  {/snippet}

  <div class="flex flex-col gap-5">
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
    {:else if view === "board"}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {#each sandboxes as record (record.sandboxId)}
          <SandboxTile
            {record}
            activity={activityFor(store, record.sandboxId)}
            onOpen={() => route.openSandbox(record.sandboxId)}
          />
        {/each}
      </div>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each sandboxes as record (record.sandboxId)}
          <SandboxListRow
            {record}
            activity={activityFor(store, record.sandboxId)}
            onOpen={() => route.openSandbox(record.sandboxId)}
          />
        {/each}
      </ul>
    {/if}
  </div>
</AppShell>
