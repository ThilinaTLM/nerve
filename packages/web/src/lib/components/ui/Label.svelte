<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    for?: string;
    class?: string;
  };

  let { children, for: forId, class: className = "" }: Props = $props();
</script>

<label
  for={forId}
  class={cn("select-none text-sm font-medium leading-none text-foreground", className)}
>
  {@render children?.()}
</label>
