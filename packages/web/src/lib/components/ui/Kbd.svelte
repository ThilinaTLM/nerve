<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    class?: string;
  };

  let { children, class: className = "" }: Props = $props();
</script>

<kbd
  class={cn(
    "inline-grid min-w-5 place-items-center rounded-sm border border-border bg-secondary px-1 font-mono text-[11px] leading-snug text-muted-foreground",
    className,
  )}>{@render children?.()}</kbd>
