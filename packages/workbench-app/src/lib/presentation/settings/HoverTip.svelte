<!-- Hover/focus explanation around a small inline target (labels, badges, switches). -->
<script lang="ts">
import type { Snippet } from "svelte";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  tip: string;
  delay?: number;
  side?: "top" | "right" | "bottom" | "left";
  class?: string;
  children: Snippet;
};

let { tip, delay = 300, side, class: className, children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={delay}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span
          {...props}
          class={cn("inline-flex min-w-0 cursor-help", className)}
          >{@render children()}</span
        >
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content {side} class="max-w-xs">{tip}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
