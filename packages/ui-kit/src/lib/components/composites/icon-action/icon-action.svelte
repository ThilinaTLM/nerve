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
  /** Marks the action as the current state, e.g. the starred default. */
  active?: boolean;
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
  active = false,
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
        <!-- The trigger props must land on a DOM element; spreading them onto a
             component drops the attachment bits-ui uses to track the node. -->
        <span {...props} class="inline-flex">
          <Button
            variant="ghost"
            size={size === "sm" ? "icon-sm" : "icon-xs"}
            disabled={disabled || busy}
            ariaLabel={label}
            data-tour-id={tourId}
            class={cn(
              "text-muted-foreground hover:text-foreground",
              tone === "destructive" && "hover:text-destructive",
              active && "text-primary hover:text-primary",
              className,
            )}
            onclick={() => onclick()}
          >
            {#if busy}
              <Spinner class="size-3.5" />
            {:else}
              <Icon
                class={cn("size-3.5", active && "fill-current")}
                aria-hidden="true"
              />
            {/if}
          </Button>
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content {side}>{label}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
