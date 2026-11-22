<script lang="ts">
import type { Snippet } from "svelte";
import Info from "@lucide/svelte/icons/info";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import { floatIn, floatOut } from "./floating-motion.js";

type Props = {
  tone?: "info" | "warning";
  /** Shows a dismiss button. */
  onDismiss?: () => void;
  /** One small action (a ghost `sm` Button). */
  action?: Snippet;
  children: Snippet;
};

let { tone = "info", onDismiss, action, children }: Props = $props();
const Icon = $derived(tone === "warning" ? TriangleAlert : Info);
</script>

<!-- A lasting status of the pane ("Previewing unsaved changes"), usually in
     the bottom-start anchor. -->
<div
  class={cn(
    "floating-surface pointer-events-auto flex max-w-full items-center gap-1.5 py-0.5 pl-2 text-ui text-muted-foreground",
    onDismiss || action ? "pr-0.5" : "pr-2.5",
  )}
  role="status"
  data-slot="floating-notice"
  in:floatIn|global
  out:floatOut|global
>
  <Icon
    class={cn(
      "size-3.5 shrink-0",
      tone === "warning" ? "text-warning" : "text-info",
    )}
    aria-hidden="true"
  />
  <span class="min-w-0 truncate py-1">{@render children()}</span>
  {@render action?.()}
  {#if onDismiss}
    <Button
      variant="ghost"
      size="icon-sm"
      ariaLabel="Dismiss"
      class="text-muted-foreground hover:text-foreground"
      onclick={onDismiss}
    >
      <X class="size-3.5" aria-hidden="true" />
    </Button>
  {/if}
</div>
