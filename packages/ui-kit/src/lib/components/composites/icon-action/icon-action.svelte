<script lang="ts">
import type { Component } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** Lucide icon component. */
  icon: Component<{ class?: string; "aria-hidden"?: boolean | "true" }>;
  /** Tooltip text and accessible name. Required so icon-only actions stay labelled. */
  label: string;
  onclick: () => void;
  tone?: "neutral" | "destructive";
  size?: "xs" | "sm";
  disabled?: boolean;
  /** Swaps the icon for a spinner and blocks activation. */
  busy?: boolean;
  side?: "top" | "right" | "bottom" | "left";
  tourId?: string;
  class?: string;
};

let {
  icon: Icon,
  label,
  onclick,
  tone = "neutral",
  size = "xs",
  disabled = false,
  busy = false,
  side = "top",
  tourId,
  class: className,
}: Props = $props();
</script>

<Tooltip.Provider delayDuration={300}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size={size === "sm" ? "icon-sm" : "icon-xs"}
          disabled={disabled || busy}
          ariaLabel={label}
          data-tour-id={tourId}
          class={cn(
            "text-muted-foreground hover:text-foreground",
            tone === "destructive" && "hover:text-destructive",
            className,
          )}
          onclick={() => onclick()}
        >
          {#if busy}
            <Spinner class="size-3.5" />
          {:else}
            <Icon class="size-3.5" aria-hidden="true" />
          {/if}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content {side}>{label}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
