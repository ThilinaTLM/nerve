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
    if (detail && detail.logsText === "") void store.loadLogs(record.sandboxId);
  });
</script>

<ScrollArea class="h-full">
  <div class="flex flex-col gap-4 p-4">
    <Card class="rounded-md border">
      <CardHeader class="flex-row items-center justify-between">
        <CardTitle class="text-sm">Logs</CardTitle>
        <div class="flex items-center gap-2">
          {#if detail?.logsTruncated}
            <Badge tone="warn" size="xs">truncated</Badge>
          {/if}
          <Button
            variant="ghost"
            size="xs"
            onclick={() => void store.loadLogs(record.sandboxId)}
          >
            <RefreshCw class="size-3.5" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {#if !detail || detail.logsText.length === 0}
          <p class="text-sm text-muted-foreground">No logs available.</p>
        {:else}
          <pre
            class="max-h-[70vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
          >{detail.logsText}</pre>
        {/if}
      </CardContent>
    </Card>
  </div>
</ScrollArea>
