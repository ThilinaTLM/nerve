<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** Accessible name of the toolbar, e.g. "Diagram controls". */
  label: string;
  class?: string;
  /** Stops pointer gestures from reaching a pannable/scrollable host. */
  isolatePointer?: boolean;
  children: Snippet;
};

let {
  label,
  class: className,
  isolatePointer = false,
  children,
}: Props = $props();
</script>

<!-- Floating dock of view controls pinned to the top-right of a content pane
     (diagrams, log streams). Content scrolls underneath it. -->
<div
  class={cn(
    "floating-surface absolute top-3 right-3 z-10 flex items-center gap-0.5 p-0.5",
    className,
  )}
  role="toolbar"
  aria-label={label}
  tabindex="-1"
  onpointerdown={isolatePointer
    ? (event) => event.stopPropagation()
    : undefined}
>
  {@render children()}
</div>
