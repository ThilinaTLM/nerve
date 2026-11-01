<script lang="ts">
import Wrench from "@lucide/svelte/icons/wrench";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/svelte";
import { cn } from "@nervekit/ui-kit/utils";
import type { HistoryPointData } from "./history-tree";

let { data }: NodeProps<Node<HistoryPointData, "point">> = $props();
</script>

<!-- A 12px hit box around a small mark: filled = you, ring = assistant. The
     label overflows to the right, sized by the layout so it stops before the
     next branch column. -->
<div class="relative flex size-3 items-center justify-center">
  <Handle
    type="target"
    position={Position.Top}
    isConnectable={false}
    style="opacity: 0"
  />
  <span
    class={cn(
      "block rounded-full",
      data.head
        ? "size-2.5 bg-primary ring-2 ring-primary-strong ring-offset-1 ring-offset-card"
        : data.kind === "start"
          ? "size-2.5 border-2 border-primary bg-card"
          : data.kind === "user"
            ? cn("size-2", data.current ? "bg-primary" : "bg-muted-foreground")
            : cn(
                "size-2 border-[1.5px] bg-card",
                data.current ? "border-primary" : "border-muted-foreground",
              ),
      data.selected && "outline-2 outline-offset-2 outline-focus",
      data.match &&
        !data.selected &&
        "outline-2 outline-offset-2 outline-warning",
    )}
  ></span>
  <span
    class={cn(
      "absolute top-1/2 left-4 flex -translate-y-1/2 items-center gap-1.5 rounded-sm px-1 text-caption whitespace-nowrap",
      data.selected && "bg-selected",
    )}
    style={`max-width: ${data.labelWidth}px`}
  >
    {#if data.toolCount}
      <span
        class="flex shrink-0 items-center gap-0.5 text-muted-foreground tabular-nums"
        ><Wrench class="size-3" aria-hidden="true" />{data.toolCount}</span
      >
    {/if}
    <span
      class={cn(
        "truncate",
        data.head
          ? "font-medium text-primary"
          : data.kind === "assistant"
            ? "text-muted-foreground"
            : "text-foreground",
      )}>{data.label}</span
    >
  </span>
  <Handle
    type="source"
    position={Position.Bottom}
    isConnectable={false}
    style="opacity: 0"
  />
</div>
