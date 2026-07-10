<script lang="ts">
  import { FileCog, RefreshCw } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/contracts";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import { CodeViewer } from "@nervekit/workbench-ui/components/workbench";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[record.sandboxId]);

  $effect(() => {
    if (!detail) return;
    if (detail.configYaml || detail.configYamlLoading || detail.configYamlError)
      return;
    void store.loadSandboxConfigYaml(record.sandboxId);
  });
</script>

<div class="relative flex h-full min-h-0 flex-col bg-background">
  <Button
    variant="ghost"
    size="icon-sm"
    ariaLabel="Refresh config YAML"
    disabled={detail?.configYamlLoading}
    class="absolute right-2 top-2 z-10 border bg-background/80 backdrop-blur-sm"
    onclick={() => void store.loadSandboxConfigYaml(record.sandboxId)}
  >
    <RefreshCw class="size-3.5" />
  </Button>

  {#if detail?.configYamlLoading}
    <div class="grid flex-1 place-content-center gap-1 text-center text-muted-foreground">
      <RefreshCw class="mx-auto size-7 animate-spin text-primary" strokeWidth={1.7} />
      <p class="text-sm">Loading config YAML…</p>
    </div>
  {:else if detail?.configYamlError}
    <div class="p-3">
      <p class="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
        {detail.configYamlError}
      </p>
    </div>
  {:else if !detail?.configYaml}
    <div class="grid flex-1 place-content-center gap-1 text-center text-muted-foreground">
      <FileCog class="mx-auto size-7 text-primary" strokeWidth={1.7} />
      <p class="text-sm text-foreground">No config YAML available.</p>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-auto p-3">
      <CodeViewer text={detail.configYaml} language="yaml" />
    </div>
  {/if}
</div>
