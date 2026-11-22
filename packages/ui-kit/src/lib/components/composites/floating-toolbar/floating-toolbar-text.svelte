<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { itemIn, itemOut } from "./floating-motion.js";

type Props = {
  tone?: "muted" | "destructive";
  /** Announces changes politely (match counts, search state). */
  live?: boolean;
  title?: string;
  class?: string;
  children: Snippet;
};

let {
  tone = "muted",
  live = false,
  title,
  class: className,
  children,
}: Props = $props();
</script>

<!-- A readout in a bar or panel (dimensions, elapsed time, match count), as
     tall as the controls so mixed rows stay aligned. -->
<span
  class={cn(
    "flex h-control-sm min-w-0 shrink-0 items-center gap-1.5 truncate px-1.5 text-ui tabular-nums",
    tone === "muted" ? "text-muted-foreground" : "text-destructive",
    className,
  )}
  aria-live={live ? "polite" : undefined}
  {title}
  in:itemIn|global
  out:itemOut|global
>
  {@render children()}
</span>
