<script lang="ts">
import { DOCK_LABELS, type DockId } from "./shell-types.js";

let {
  dock,
  hovered = false,
}: {
  dock: DockId;
  /** Highlights the target while the pointer is over this dock. */
  hovered?: boolean;
} = $props();
</script>

<div class="dock-drop-indicator" class:hovered aria-hidden="true">
  <span class="dock-drop-label">Move to {DOCK_LABELS[dock]}</span>
</div>

<style>
/* Drop affordances shown only while a panel view drag is in flight. */
.dock-drop-indicator {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  border: 2px dashed transparent;
  pointer-events: none;
}

.dock-drop-indicator.hovered {
  border-color: var(--primary);
  background: color-mix(in oklab, var(--primary) 12%, transparent);
}

.dock-drop-label {
  opacity: 0;
}

.dock-drop-indicator.hovered .dock-drop-label {
  opacity: 1;
  border-radius: var(--radius-md);
  background: var(--primary);
  padding: 0.15rem 0.5rem;
  color: var(--primary-foreground);
  font-size: var(--text-xs);
}
</style>
