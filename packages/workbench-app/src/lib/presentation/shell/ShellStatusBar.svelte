<script lang="ts" module>
import type { DockId } from "./shell-types.js";

export type DockToggle = {
  dock: DockId;
  label: string;
  /** True when the dock is visible. */
  open: boolean;
  onToggle: () => void;
};
</script>

<script lang="ts">
import PanelBottom from "@lucide/svelte/icons/panel-bottom";
import PanelBottomClose from "@lucide/svelte/icons/panel-bottom-close";
import PanelLeft from "@lucide/svelte/icons/panel-left";
import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
import PanelRight from "@lucide/svelte/icons/panel-right";
import PanelRightClose from "@lucide/svelte/icons/panel-right-close";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let {
  toggles = [],
  left,
  right,
}: {
  toggles?: DockToggle[];
  left?: Snippet;
  right?: Snippet;
} = $props();

const icons = {
  left: { open: PanelLeftClose, closed: PanelLeft },
  right: { open: PanelRightClose, closed: PanelRight },
  bottom: { open: PanelBottomClose, closed: PanelBottom },
} as const;

// The left dock toggle anchors the status bar's left edge; the other docks
// group with the trailing status chips, mirroring the workspace geometry.
const leadingToggles = $derived(
  toggles.filter((toggle) => toggle.dock === "left"),
);
const trailingToggles = $derived(
  toggles.filter((toggle) => toggle.dock !== "left"),
);
</script>

{#snippet toggleButton(toggle: DockToggle)}
  {@const Icon = toggle.open
    ? icons[toggle.dock].open
    : icons[toggle.dock].closed}
  <Button
    variant="ghost"
    size="icon-sm"
    class="size-5.5 rounded-sm max-sm:size-9"
    ariaLabel={`Toggle ${toggle.label}`}
    title={toggle.open ? `Hide ${toggle.label}` : `Show ${toggle.label}`}
    pressed={toggle.open}
    onclick={toggle.onToggle}
  >
    <Icon size={13} strokeWidth={2.1} aria-hidden="true" />
  </Button>
{/snippet}

<footer
  class="flex h-full min-w-0 items-center justify-between gap-3 bg-card px-1.5 text-xs text-muted-foreground select-none max-sm:pb-[env(safe-area-inset-bottom)]"
>
  <div class="flex min-w-0 flex-auto items-center gap-0.5 overflow-hidden">
    {#each leadingToggles as toggle (toggle.dock)}
      {@render toggleButton(toggle)}
    {/each}
    {#if left}
      {@render left()}
    {/if}
  </div>

  <div class="flex min-w-0 flex-none items-center gap-0.5">
    {#if right}
      {@render right()}
    {/if}
    {#each trailingToggles as toggle (toggle.dock)}
      {@render toggleButton(toggle)}
    {/each}
  </div>
</footer>
