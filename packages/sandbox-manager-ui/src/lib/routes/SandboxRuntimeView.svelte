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
  const runtime = $derived(store.managerStatus?.runtime);

  const capabilities = $derived(
    runtime
      ? [
          ["Read-only rootfs", runtime.supportsReadOnlyRootFilesystem],
          ["No new privileges", runtime.supportsNoNewPrivileges],
          ["Pids limit", runtime.supportsPidsLimit],
          ["CPU limit", runtime.supportsCpuLimit],
          ["Memory limit", runtime.supportsMemoryLimit],
          ["Tmpfs", runtime.supportsTmpfs],
        ]
      : [],
  );
</script>

<ScrollArea class="h-full">
  <div class="flex flex-col gap-4 p-4">
    {#if runtime}
      <Card class="rounded-md border">
        <CardHeader><CardTitle class="text-sm">Runtime capabilities</CardTitle></CardHeader>
        <CardContent class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {#each capabilities as [label, supported] (label)}
            <div class="flex items-center gap-1.5">
              <Badge tone={supported ? "good" : "neutral"} size="xs">
                {supported ? "yes" : "no"}
              </Badge>
              <span class="text-muted-foreground">{label}</span>
            </div>
          {/each}
        </CardContent>
      </Card>
    {/if}

    {#if record.containerRef}
      <Card class="rounded-md border">
        <CardHeader><CardTitle class="text-sm">Container</CardTitle></CardHeader>
        <CardContent class="flex flex-col gap-1 text-sm">
          <span class="font-mono text-xs">{record.containerRef.kind}: {record.containerRef.id}</span>
          {#if record.containerRef.name}
            <span class="font-mono text-xs text-muted-foreground">{record.containerRef.name}</span>
          {/if}
        </CardContent>
      </Card>
    {/if}

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
            class="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
          >{detail.logsText}</pre>
        {/if}
      </CardContent>
    </Card>
  </div>
</ScrollArea>
