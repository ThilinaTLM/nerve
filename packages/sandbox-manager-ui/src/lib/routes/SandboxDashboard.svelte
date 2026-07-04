<script lang="ts">
  import { Boxes, Plus } from "@lucide/svelte";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@nervekit/ui/components/ui/card";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import SandboxStatusBadge from "../components/SandboxStatusBadge.svelte";
  import SandboxSummaryCards from "../components/SandboxSummaryCards.svelte";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  const store = useSandboxManagerStore();
  const runtime = $derived(store.managerStatus?.runtime);
</script>

<ScrollArea class="h-full">
  <div class="mx-auto flex max-w-5xl flex-col gap-5 p-5">
    <div class="flex flex-col gap-0.5">
      <h1 class="text-lg font-semibold">Fleet overview</h1>
      <p class="text-sm text-muted-foreground">
        Monitor and manage sandbox containers owned by this manager.
      </p>
    </div>

    {#if store.connection !== "live"}
      <div
        class="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground"
      >
        <StatusDot tone="running" pulse />
        <span class="capitalize">{store.connection}</span>
        <span>to the sandbox manager…</span>
      </div>
    {/if}

    <SandboxSummaryCards />

    {#if runtime}
      <Card class="border">
        <CardHeader>
          <CardTitle class="text-sm">Runtime availability</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-2 text-sm">
          <div class="flex items-center gap-2">
            <span class="font-mono">{runtime.kind}</span>
            <span class={runtime.available ? "text-success" : "text-destructive"}>
              {runtime.available ? "available" : "unavailable"}
            </span>
            {#if runtime.rootless}<span class="text-muted-foreground">rootless</span>{/if}
          </div>
          {#if runtime.limitations.length > 0}
            <ul class="list-disc pl-5 text-xs text-muted-foreground">
              {#each runtime.limitations as limitation (limitation)}
                <li>{limitation}</li>
              {/each}
            </ul>
          {/if}
        </CardContent>
      </Card>
    {/if}

    <Card class="border">
      <CardHeader>
        <CardTitle class="text-sm">Fleet</CardTitle>
      </CardHeader>
      <CardContent>
        {#if store.sandboxes.length === 0}
          <div class="flex flex-col items-center gap-3 py-10 text-center">
            <Boxes class="size-8 text-muted-foreground" />
            <p class="text-sm text-muted-foreground">
              No sandboxes yet. Create one to get started.
            </p>
            <Button size="sm" onclick={() => (store.createDialogOpen = true)}>
              <Plus class="size-4" /> New sandbox
            </Button>
          </div>
        {:else}
          <ul class="flex flex-col divide-y">
            {#each store.sandboxes as record (record.sandboxId)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-muted"
                  onclick={() => void store.selectSandbox(record.sandboxId)}
                >
                  <div class="flex min-w-0 flex-col">
                    <span class="truncate text-sm font-medium">
                      {record.name ?? record.sandboxId}
                    </span>
                    <span class="truncate font-mono text-xs text-muted-foreground">
                      {record.image.reference}
                    </span>
                  </div>
                  <SandboxStatusBadge {record} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </CardContent>
    </Card>
  </div>
</ScrollArea>
