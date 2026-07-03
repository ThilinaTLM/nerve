<script lang="ts">
  import { Boxes, PanelLeft, Plus, RefreshCw } from "@lucide/svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Sheet from "$lib/components/ui/sheet";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { StatusTone } from "$lib/components/ui/status-dot";
  import CreateSandboxDialog from "../components/create/CreateSandboxDialog.svelte";
  import RuntimeBackendBadge from "../components/RuntimeBackendBadge.svelte";
  import SandboxFleetList from "../components/SandboxFleetList.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import SandboxDashboard from "./SandboxDashboard.svelte";
  import SandboxDetail from "./SandboxDetail.svelte";

  const store = useSandboxManagerStore();
  let sheetOpen = $state(false);

  const connectionTone = $derived<StatusTone>(
    store.connection === "live"
      ? "good"
      : store.connection === "connecting" || store.connection === "reconnecting"
        ? "running"
        : store.connection === "error"
          ? "danger"
          : "neutral",
  );
  const selected = $derived(
    store.selectedSandboxId
      ? store.sandboxes.find(
          (record) => record.sandboxId === store.selectedSandboxId,
        )
      : undefined,
  );
</script>

<div class="flex h-svh flex-col bg-background text-foreground">
  <header
    class="flex flex-none items-center gap-3 border-b px-4 py-2.5"
  >
    <Button
      variant="ghost"
      size="icon-sm"
      class="md:hidden"
      ariaLabel="Open sandbox list"
      onclick={() => (sheetOpen = true)}
    >
      <PanelLeft class="size-4" />
    </Button>
    <div class="flex items-center gap-2">
      <Boxes class="size-5 text-primary" />
      <span class="text-sm font-semibold">Sandbox Manager</span>
    </div>
    <div class="flex items-center gap-1.5">
      <StatusDot tone={connectionTone} pulse={store.connection === "reconnecting"} />
      <span class="text-xs text-muted-foreground capitalize">{store.connection}</span>
    </div>
    {#if store.managerStatus}
      <RuntimeBackendBadge
        backend={store.managerStatus.backend}
        runtime={store.managerStatus.runtime}
      />
      {#if store.managerStatus.hardening.apiAuth === "disabled"}
        <Badge tone="warn" size="xs">auth disabled</Badge>
      {/if}
    {/if}
    <div class="ml-auto flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => void store.refreshFleet()}
      >
        <RefreshCw class="size-4" /> Refresh
      </Button>
      <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
        <Plus class="size-4" /> New sandbox
      </Button>
    </div>
  </header>

  <div class="flex min-h-0 flex-1">
    <aside class="hidden w-80 flex-none border-r md:flex">
      <SandboxFleetList />
    </aside>
    <main class="min-w-0 flex-1 overflow-hidden">
      {#if selected}
        <SandboxDetail record={selected} />
      {:else}
        <SandboxDashboard />
      {/if}
    </main>
  </div>
</div>

<Sheet.Root bind:open={sheetOpen}>
  <Sheet.Content side="left" class="w-80 p-0">
    <SandboxFleetList onselect={() => (sheetOpen = false)} />
  </Sheet.Content>
</Sheet.Root>

<CreateSandboxDialog bind:open={store.createDialogOpen} />
