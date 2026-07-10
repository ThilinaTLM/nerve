<script lang="ts">
import PanelLeft from "@lucide/svelte/icons/panel-left";
import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
import PanelRight from "@lucide/svelte/icons/panel-right";
import PanelRightClose from "@lucide/svelte/icons/panel-right-close";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/workbench-ui/components/ui/button";

let {
  sidebarCollapsed = false,
  utilityCollapsed = false,
  sidebarLabel = "agents panel",
  utilityLabel = "utility panel",
  onToggleSidebar,
  onToggleUtility,
  left,
  right,
}: {
  sidebarCollapsed?: boolean;
  utilityCollapsed?: boolean;
  sidebarLabel?: string;
  utilityLabel?: string;
  onToggleSidebar?: () => void;
  onToggleUtility?: () => void;
  left?: Snippet;
  right?: Snippet;
} = $props();
</script>

<footer class="footerbar">
  <div class="footer-group footer-left">
    {#if onToggleSidebar}
      <Button
        variant="ghost"
        size="icon-sm"
        class="footer-toggle"
        ariaLabel={`Toggle ${sidebarLabel}`}
        title={sidebarCollapsed
          ? `Show ${sidebarLabel}`
          : `Hide ${sidebarLabel}`}
        pressed={!sidebarCollapsed}
        onclick={onToggleSidebar}
      >
        {#if sidebarCollapsed}
          <PanelLeft size={13} strokeWidth={2.1} aria-hidden="true" />
        {:else}
          <PanelLeftClose size={13} strokeWidth={2.1} aria-hidden="true" />
        {/if}
      </Button>
    {/if}
    {#if left}
      {@render left()}
    {/if}
  </div>

  <div class="footer-group footer-right">
    {#if right}
      {@render right()}
    {/if}
    {#if onToggleUtility}
      <Button
        variant="ghost"
        size="icon-sm"
        class="footer-toggle"
        ariaLabel={`Toggle ${utilityLabel}`}
        title={utilityCollapsed
          ? `Show ${utilityLabel}`
          : `Hide ${utilityLabel}`}
        pressed={!utilityCollapsed}
        onclick={onToggleUtility}
      >
        {#if utilityCollapsed}
          <PanelRight size={13} strokeWidth={2.1} aria-hidden="true" />
        {:else}
          <PanelRightClose size={13} strokeWidth={2.1} aria-hidden="true" />
        {/if}
      </Button>
    {/if}
  </div>
</footer>
