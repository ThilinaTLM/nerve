<script lang="ts">
  import { RefreshCw } from "@lucide/svelte";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@nervekit/ui/components/ui/card";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
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

<ScrollArea class="h-full">
  <div class="flex flex-col gap-4 p-4">
    <Card class="border">
      <CardHeader class="flex-row items-start justify-between gap-3">
        <div class="min-w-0">
          <CardTitle class="text-sm">Sandbox config YAML</CardTitle>
          <p class="mt-1 text-xs text-muted-foreground">
            Exact sandbox-agent config mounted for this sandbox. Launch fields such
            as image and start behavior are not part of this YAML.
          </p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {#if detail?.configYamlSource}
            <Badge tone="neutral" size="xs">{detail.configYamlSource}</Badge>
          {/if}
          {#if detail?.configYamlDigest}
            <Badge tone="neutral" size="xs">{detail.configYamlDigest}</Badge>
          {/if}
          <Button
            variant="ghost"
            size="xs"
            disabled={detail?.configYamlLoading}
            onclick={() => void store.loadSandboxConfigYaml(record.sandboxId)}
          >
            <RefreshCw class="size-3.5" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {#if detail?.configYamlLoading}
          <p class="text-sm text-muted-foreground">Loading config YAML…</p>
        {:else if detail?.configYamlError}
          <p class="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {detail.configYamlError}
          </p>
        {:else if !detail?.configYaml}
          <p class="text-sm text-muted-foreground">No config YAML available.</p>
        {:else}
          <pre
            class="max-h-[70vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre"
          >{detail.configYaml}</pre>
        {/if}
      </CardContent>
    </Card>
  </div>
</ScrollArea>
