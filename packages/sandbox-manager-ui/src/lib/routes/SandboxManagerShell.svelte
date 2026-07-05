<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import CreateSandboxDialog from "../components/create/CreateSandboxDialog.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
  import FleetPage from "./FleetPage.svelte";
  import SandboxPage from "./SandboxPage.svelte";
  import SandboxChatPage from "./SandboxChatPage.svelte";
  import SettingsPage from "./SettingsPage.svelte";
  import { SandboxManagerRouteState } from "./route-state.svelte";

  const store = useSandboxManagerStore();
  const route = new SandboxManagerRouteState();
  let stopRouteListener: (() => void) | undefined;

  onMount(() => {
    stopRouteListener = route.listen();
  });

  onDestroy(() => {
    stopRouteListener?.();
  });

  // Keep the active sandbox subscription in sync with the current route.
  $effect(() => {
    const id = route.sandboxId;
    if ((route.kind === "sandbox" || route.kind === "chat") && id) {
      if (store.selectedSandboxId !== id) void store.selectSandbox(id);
    } else if (store.selectedSandboxId) {
      void store.selectSandbox(undefined);
    }
  });
</script>

{#if route.kind === "settings"}
  <SettingsPage {route} />
{:else if route.kind === "chat" && route.sandboxId}
  <SandboxChatPage {route} sandboxId={route.sandboxId} />
{:else if route.kind === "sandbox" && route.sandboxId}
  <SandboxPage {route} sandboxId={route.sandboxId} />
{:else}
  <FleetPage {route} />
{/if}

<CreateSandboxDialog bind:open={store.createDialogOpen} />
