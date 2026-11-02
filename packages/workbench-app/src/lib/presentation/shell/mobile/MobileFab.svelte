<script lang="ts">
import type { Snippet } from "svelte";
import Plus from "@lucide/svelte/icons/plus";
import type { PanelViewIcon } from "../shell-types.js";

/**
 * Screen body with one floating action pill docked bottom-right, in the thumb
 * zone. The pill sits above whatever is docked below this screen: with the tab
 * bar it clears the bar (the bar owns the home indicator), without it the
 * shell's `--mobile-content-bottom` supplies the safe-area inset. Scrolling
 * content is padded past the pill so the last row is never covered.
 */
let {
  label,
  ariaLabel,
  icon,
  disabled = false,
  onclick,
  children,
}: {
  label: string;
  ariaLabel?: string;
  icon?: PanelViewIcon;
  disabled?: boolean;
  onclick: () => void;
  children: Snippet;
} = $props();

const Icon = $derived(icon ?? Plus);
</script>

<div class="mobile-fab-host">
  <div class="mobile-fab-content">
    {@render children()}
  </div>
  <button
    type="button"
    class="mobile-fab"
    aria-label={ariaLabel ?? label}
    {disabled}
    {onclick}
  >
    <Icon size={18} strokeWidth={2.1} />
    <span class="text-ui font-medium">{label}</span>
  </button>
</div>

<style>
.mobile-fab-host {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  /* Snapshot of the shell's bottom clearance, before the pill adds its own. */
  --fab-base: var(--mobile-content-bottom, 0px);
}

/* Scrolling bodies read this variable for their last-row clearance. */
.mobile-fab-content {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  --mobile-content-bottom: calc(var(--fab-base) + 4.75rem);
}

.mobile-fab {
  position: absolute;
  right: 1rem;
  bottom: calc(1rem + var(--fab-base));
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 3rem;
  padding: 0 1.25rem;
  border-radius: 9999px;
  background: var(--primary);
  color: var(--primary-foreground);
  box-shadow: var(--shadow-overlay);
}

.mobile-fab:disabled {
  background: var(--muted);
  color: var(--muted-foreground);
  box-shadow: none;
}
</style>
