<script lang="ts">
import type { Snippet } from "svelte";
import { setSidebar } from "./context.svelte.js";

let { children }: { children?: Snippet } = $props();

// Provider-light: supply a static expanded, non-mobile context so
// `SidebarMenuButton` can call `useSidebar()` without pulling in the full
// sidebar layout machinery (keyboard shortcut, cookie persistence, mobile sheet).
setSidebar({
  state: "expanded",
  open: true,
  openMobile: false,
  isMobile: false,
  setOpen: () => {},
  setOpenMobile: () => {},
  toggle: () => {},
});
</script>

<!-- `display: contents` keeps `.project-tree` as the direct pane child so the
     existing navigator-pane grid/height layout is unaffected. -->
<div data-slot="sidebar-provider" style="display: contents;">
  {@render children?.()}
</div>
