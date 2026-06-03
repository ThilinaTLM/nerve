<script lang="ts">
  import { Separator as SeparatorPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  type Props = {
    orientation?: "horizontal" | "vertical";
    class?: string;
  };

  let { orientation = "horizontal", class: className = "" }: Props = $props();
</script>

<SeparatorPrimitive.Root class={cn("ui-separator", orientation, className)} {orientation} />

<style>
  :global(.ui-separator) {
    background: hsl(var(--border) / 0.6);
  }

  :global(.horizontal) {
    width: 100%;
    height: 1px;
  }

  :global(.vertical) {
    width: 1px;
    height: 100%;
  }
</style>
