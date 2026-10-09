<script lang="ts">
import { Handle, Position, type NodeProps } from "@xyflow/svelte";
import GitBranch from "@lucide/svelte/icons/git-branch";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { HistoryNode } from "./history-graph";
let { data, selected }: NodeProps<HistoryNode> = $props();
</script>
<div
  class="flex h-full w-full flex-col rounded-lg border bg-card text-card-foreground shadow-sm"
  class:border-primary={selected || data.active}
>
  <Handle type="target" position={Position.Top} isConnectable={false} />
  <div class="flex items-center gap-2 border-b px-3 py-2">
    <span class="truncate text-sm font-semibold"
      >{data.event?.type ?? "Start"}</span
    >{#if data.active}<span class="ml-auto text-xs text-info">Current</span
      >{/if}
  </div>
  <div class="min-h-0 flex-1 px-3 py-2.5">
    <p class="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
      {data.event?.preview ?? "Beginning of conversation"}
    </p>
  </div>
  <div class="flex justify-end border-t px-2 py-1.5">
    <Button
      variant="ghost"
      size="icon-xs"
      class="nodrag nopan"
      disabled={data.disabled || !data.onSelect}
      aria-label="Branch from here"
      onclick={() => data.onSelect?.(data.event?.id ?? null)}
      ><GitBranch size={14} /></Button
    >
  </div>
  <Handle type="source" position={Position.Bottom} isConnectable={false} />
</div>
