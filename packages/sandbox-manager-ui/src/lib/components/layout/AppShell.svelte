<script lang="ts">
  import { Boxes, Settings2 } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import type { StatusTone } from "@nervekit/ui/components/ui/status-dot";
  import RuntimeBackendBadge from "../RuntimeBackendBadge.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import type { SandboxManagerRouteState } from "../../routes/route-state.svelte";

  let {
    route,
    contentVariant = "contained",
    actions,
    children,
  }: {
    route: SandboxManagerRouteState;
    contentVariant?: "contained" | "full";
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const store = useSandboxManagerStore();

  const connectionTone = $derived<StatusTone>(
    store.connection === "live"
      ? "good"
      : store.connection === "connecting" || store.connection === "reconnecting"
        ? "running"
        : store.connection === "error"
          ? "danger"
          : "neutral",
  );

  const navItems = [
    { kind: "fleet" as const, label: "Sandboxes", icon: Boxes, onSelect: () => route.fleet() },
    { kind: "settings" as const, label: "Settings", icon: Settings2, onSelect: () => route.openSettings() },
  ];

  function isActive(kind: string): boolean {
    if (kind === "fleet")
      return route.kind === "fleet" || route.kind === "sandbox" || route.kind === "chat";
    return route.kind === kind;
  }
</script>

<div class="flex h-svh flex-col bg-background text-foreground">
  <header class="flex flex-none items-center gap-4 border-b bg-card px-4 py-2">
    <button
      type="button"
      class="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold hover:text-foreground/90"
      onclick={() => route.fleet()}
    >
      <Boxes class="size-5 text-primary" />
      <span class="hidden sm:inline">Sandbox Manager</span>
    </button>

    <nav class="flex items-center gap-1">
      {#each navItems as item (item.kind)}
        {@const Icon = item.icon}
        <Button
          variant={isActive(item.kind) ? "secondary" : "ghost"}
          size="sm"
          active={isActive(item.kind)}
          onclick={item.onSelect}
        >
          <Icon class="size-4" />
          <span class="hidden md:inline">{item.label}</span>
        </Button>
      {/each}
    </nav>

    <div class="ml-auto flex items-center gap-2">
      {#if store.managerStatus}
        <RuntimeBackendBadge
          backend={store.managerStatus.backend}
          runtime={store.managerStatus.runtime}
        />
        {#if store.managerStatus.hardening.apiAuth === "disabled"}
          <Badge tone="warn" size="xs">auth disabled</Badge>
        {/if}
      {/if}
      <Badge tone={connectionTone} size="sm" class="gap-1.5">
        <StatusDot
          tone={connectionTone}
          pulse={store.connection === "reconnecting" ||
            store.connection === "connecting"}
        />
        <span class="capitalize">{store.connection}</span>
      </Badge>
      {#if actions}{@render actions()}{/if}
    </div>
  </header>

  {#if contentVariant === "full"}
    <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
      {@render children()}
    </main>
  {:else}
    <main class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        {@render children()}
      </div>
    </main>
  {/if}
</div>
