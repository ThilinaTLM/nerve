<script lang="ts">
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "@nervekit/ui/components/ui/card";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";

  let { record }: { record: ManagedSandboxRecord } = $props();

  const store = useSandboxManagerStore();
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
  </div>
</ScrollArea>
