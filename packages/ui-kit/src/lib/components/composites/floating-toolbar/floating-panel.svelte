<!--
@component
Expanded form of a floating bar for fields (find, filter, go to). Fields (`Input`, `SearchInput`, `SelectField`) go only here, never on a `FloatingToolbar`. Full width in narrow panes; place it in a `FloatingLayer` anchor, usually `topEnd`.
-->

<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { autoSize, floatIn, floatOut } from "./floating-motion.js";

type Props = {
  /** Accessible name, e.g. "Find in file". */
  label: string;
  /** `search` for find and filter forms. */
  role?: "search" | "group";
  /** Width from a 24rem pane up: `sm` 20rem, `md` 24rem, `lg` 28rem. Narrower panes: full width. */
  size?: "sm" | "md" | "lg";
  /** Escape inside the panel calls it. */
  onClose?: () => void;
  ref?: HTMLElement | null;
  children: Snippet;
};

let {
  label,
  role = "group",
  size = "md",
  onClose,
  ref = $bindable(null),
  children,
}: Props = $props();

const WIDTH = { sm: "@sm:w-80", md: "@sm:w-96", lg: "@sm:w-112" } as const;
</script>

<!-- The expanded sibling of a bar, for inline tasks with fields (find,
     replace, go to line). Same surface and controls as a bar; its height
     animates when rows open or close. -->
<div
  bind:this={ref}
  class={cn(
    "floating-surface pointer-events-auto w-full overflow-clip [overflow-clip-margin:4px]",
    WIDTH[size],
  )}
  {role}
  aria-label={label}
  data-slot="floating-panel"
  onkeydown={(event) => {
    if (event.key === "Escape" && onClose && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  }}
  onpointerdown={(event) => event.stopPropagation()}
  {@attach autoSize("height")}
  in:floatIn|global
  out:floatOut|global
>
  <div class="grid gap-1 p-0.5">
    {@render children()}
  </div>
</div>
