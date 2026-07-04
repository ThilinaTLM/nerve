<script lang="ts">
  import { Boxes, PanelLeft, Plus, RefreshCw, Settings2 } from "@lucide/svelte";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import * as Sheet from "@nervekit/ui/components/ui/sheet";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import type { StatusTone } from "@nervekit/ui/components/ui/status-dot";
  import CreateSandboxDialog from "../components/create/CreateSandboxDialog.svelte";
  import RuntimeBackendBadge from "../components/RuntimeBackendBadge.svelte";
  import SandboxFleetList from "../components/SandboxFleetList.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import SandboxDashboard from "./SandboxDashboard.svelte";
  import SandboxDetail from "./SandboxDetail.svelte";
  import SandboxSettings from "./SandboxSettings.svelte";
  import { SandboxManagerRouteState } from "./route-state.svelte";
  import { onDestroy, onMount } from "svelte";

  const store = useSandboxManagerStore();
  const route = new SandboxManagerRouteState();
  let sheetOpen = $state(false);
  let stopRouteListener: (() => void) | undefined;

  onMount(() => {
    stopRouteListener = route.listen();
  });

  onDestroy(() => {
    stopRouteListener?.();
  });

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
    class="flex flex-none flex-wrap items-center gap-3 border-b bg-card px-4 py-2.5"
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
    <Badge tone={connectionTone} size="sm" class="gap-1.5">
      <StatusDot
        tone={connectionTone}
        pulse={store.connection === "reconnecting" ||
          store.connection === "connecting"}
      />
      <span class="capitalize">{store.connection}</span>
    </Badge>
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
      {#if route.route === "/settings"}
        <Button variant="ghost" size="sm" onclick={() => route.navigate("/")}>
          <Boxes class="size-4" /> Fleet
        </Button>
      {:else}
        <Button variant="ghost" size="sm" onclick={() => route.navigate("/settings")}>
          <Settings2 class="size-4" /> Settings
        </Button>
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
      {/if}
    </div>
  </header>

  {#if route.route === "/settings"}
    <main class="min-h-0 flex-1 overflow-hidden">
      <SandboxSettings />
    </main>
  {:else}
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
  {/if}
</div>

<Sheet.Root bind:open={sheetOpen}>
  <Sheet.Content side="left" class="w-80 p-0">
    <SandboxFleetList onselect={() => (sheetOpen = false)} />
  </Sheet.Content>
</Sheet.Root>

<CreateSandboxDialog bind:open={store.createDialogOpen} />
