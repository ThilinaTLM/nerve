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
