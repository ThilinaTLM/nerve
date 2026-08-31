<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAttributes } from "svelte/elements";
import { cn } from "@nervekit/ui-kit/utils";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  ref?: HTMLElement | null;
  viewportRef?: HTMLElement | null;
  orientation?: "vertical" | "horizontal" | "both";
  viewportClass?: string;
  children?: Snippet;
};

let {
  ref = $bindable(null),
  viewportRef = $bindable(null),
  class: className,
  orientation = "vertical",
  viewportClass = "",
  children,
  ...restProps
}: Props = $props();

const overflowClass = $derived(
  orientation === "both"
    ? "overflow-auto"
    : orientation === "horizontal"
      ? "overflow-x-auto overflow-y-hidden"
      : "overflow-y-auto overflow-x-hidden",
);
</script>

<div
  bind:this={ref}
  data-slot="scroll-area"
  class={cn("relative", className)}
  {...restProps}
>
  <div
    bind:this={viewportRef}
    data-slot="scroll-area-viewport"
    data-orientation={orientation}
    class={cn(
      "cn-scroll-area-viewport focus-visible:ring-ring/50 size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
      overflowClass,
      viewportClass,
    )}
  >
    {@render children?.()}
  </div>
</div>
