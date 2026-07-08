<script lang="ts">
  import { RefreshCw, Terminal, TriangleAlert } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import { CodeViewer } from "@nervekit/shared-ui/components/workbench";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);
  const unavailable = $derived(detail?.logsAvailable === false);
  const limitations = $derived(detail?.logsLimitations ?? []);

  $effect(() => {
    if (
      detail &&
      detail.logsText === "" &&
      detail.logsAvailable !== false &&
      limitations.length === 0
    )
      void store.loadLogs(record.sandboxId);
  });
</script>

<div class="relative flex h-full min-h-0 flex-col bg-background">
  <Button
    variant="ghost"
    size="icon-sm"
    ariaLabel="Refresh logs"
    class="absolute right-2 top-2 z-10 border bg-background/80 backdrop-blur-sm"
    onclick={() => void store.loadLogs(record.sandboxId)}
  >
    <RefreshCw class="size-3.5" />
  </Button>

  {#if unavailable}
    <div class="grid flex-1 place-content-center gap-2 p-4 text-center text-muted-foreground">
      <TriangleAlert class="mx-auto size-7 text-warning" strokeWidth={1.7} />
      <p class="text-sm text-foreground">Container logs unavailable.</p>
      {#if limitations.length > 0}
        <ul class="mx-auto max-w-md list-disc text-left text-xs">
          {#each limitations as limitation}
            <li>{limitation}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if !detail || detail.logsText.length === 0}
    <div class="grid flex-1 place-content-center gap-1 text-center text-muted-foreground">
      <Terminal class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="text-sm text-foreground">No logs yet.</p>
    </div>
  {:else}
    {#if detail.logsTruncated}
      <p class="flex-none border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Logs are truncated. Refresh with a narrower tail/since range for full output.
      </p>
    {/if}
    <div class="min-h-0 flex-1 overflow-auto p-3">
      <CodeViewer text={detail.logsText} wrap />
    </div>
  {/if}
</div>
