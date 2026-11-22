<script lang="ts">
import type { Component } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";
import { itemIn, itemOut } from "./floating-motion.js";

type Props = {
  /** Tooltip text and accessible name. */
  label: string;
  /** Lucide icon component. */
  icon?: Component<{ class?: string; "aria-hidden"?: boolean | "true" }>;
  /** Short visible text instead of an icon ("232%"); horizontal bars only. */
  text?: string;
  /** Shortcut shown in the tooltip ("Shift+Enter"). */
  shortcut?: string;
  /** Toggle state; leave unset for a plain action. */
  pressed?: boolean;
  disabled?: boolean;
  /** Swaps the icon for a spinner and blocks activation. */
  busy?: boolean;
  tone?: "neutral" | "destructive";
  /** Tooltip side; default: away from the anchor edge. */
  side?: "top" | "right" | "bottom" | "left";
  onclick?: (event: MouseEvent) => void;
  /** Forwarded to the button, e.g. trigger props of a popover. */
  [key: string]: unknown;
};

let {
  label,
  icon: Icon,
  text,
  shortcut,
  pressed,
  disabled = false,
  busy = false,
  tone = "neutral",
  side,
  onclick,
  ...rest
}: Props = $props();

let trigger = $state<HTMLElement | null>(null);
const tooltipSide = $derived.by(() => {
  if (side) return side;
  const anchor =
    trigger?.closest<HTMLElement>("[data-floating-anchor]")?.dataset
      .floatingAnchor ?? "top-end";
  if (trigger?.closest("[data-orientation=vertical]"))
    return anchor.endsWith("start") ? "right" : "left";
  return anchor.startsWith("bottom") ? "top" : "bottom";
});
</script>

<!-- The button of a floating bar or panel: icon-only (or short text) with a
     tooltip that names it and shows its shortcut. `pressed` makes it a toggle
     with the shared selected treatment. -->
<Tooltip.Provider delayDuration={400}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span
          bind:this={trigger}
          {...props}
          class="inline-flex"
          in:itemIn|global
          out:itemOut|global
        >
          <Button
            {...rest}
            variant="ghost"
            size={text ? "sm" : "icon-sm"}
            {pressed}
            active={pressed}
            ariaLabel={text && text !== label ? `${text}, ${label}` : label}
            disabled={disabled || busy}
            class={cn(
              "text-muted-foreground hover:text-foreground data-[active]:bg-selected data-[active]:text-primary",
              text && "min-w-12 tabular-nums",
              tone === "destructive" && "hover:text-destructive",
            )}
            onclick={(event: MouseEvent) => onclick?.(event)}
          >
            {#if busy}
              <Spinner class="size-3.5" />
            {:else if text}
              {text}
            {:else if Icon}
              <Icon class="size-3.5" aria-hidden="true" />
            {/if}
          </Button>
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side={tooltipSide}>
      {label}
      {#if shortcut}<Kbd>{shortcut}</Kbd>{/if}
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
