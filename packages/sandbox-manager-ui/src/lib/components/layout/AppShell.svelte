<script lang="ts">
  import type { Snippet } from "svelte";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import RuntimeBackendBadge from "../RuntimeBackendBadge.svelte";
  import ActivityRail from "./ActivityRail.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import type { SandboxManagerRouteState } from "../../routes/route-state.svelte";

  let {
    route,
    contentVariant = "contained",
    title,
    subtitle,
    header,
    actions,
    children,
  }: {
    route: SandboxManagerRouteState;
    contentVariant?: "contained" | "full";
    title?: string;
    subtitle?: string;
    header?: Snippet;
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const store = useSandboxManagerStore();
  const showSubheader = $derived(
    Boolean(header || title || subtitle || actions),
  );
</script>

<div class="flex h-svh bg-background text-foreground">
  <ActivityRail {route} />

  <div class="flex min-w-0 flex-1 flex-col">
    {#if showSubheader}
      <header
        class="flex flex-none flex-wrap items-center gap-3 border-b bg-background px-4 py-2.5 md:px-6"
      >
        {#if header}
          {@render header()}
        {:else}
          <div class="flex min-w-0 flex-col">
            {#if title}<h1 class="truncate text-base font-semibold">{title}</h1>{/if}
            {#if subtitle}<p class="truncate text-xs text-muted-foreground">{subtitle}</p>{/if}
          </div>
        {/if}

        <div class="ml-auto flex flex-wrap items-center gap-2">
          {#if store.managerStatus}
            <RuntimeBackendBadge
              backend={store.managerStatus.backend}
              runtime={store.managerStatus.runtime}
            />
            {#if store.managerStatus.hardening.apiAuth === "disabled"}
              <Badge tone="warn" size="xs">auth disabled</Badge>
            {/if}
          {/if}
          {#if actions}{@render actions()}{/if}
        </div>
      </header>
    {/if}

    {#if contentVariant === "full"}
      <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
        {@render children()}
      </main>
    {:else}
      <main class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
          {@render children()}
        </div>
      </main>
    {/if}
  </div>
</div>
