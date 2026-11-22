<!--
  Column header for LayerRow's split layout: the first row of a section, labels
  over the two halves. Renders nothing without a project.
-->
<script lang="ts">
import HoverTip from "./HoverTip.svelte";
import { projectColumnTip, USER_COLUMN_TIP } from "./settings-origin";

let {
  projectName,
  projectOnly = false,
}: { projectName?: string; projectOnly?: boolean } = $props();
</script>

{#if projectName}
  <div
    class="grid grid-cols-2 gap-3 px-3 pt-2 pb-1.5 text-caption text-muted-foreground"
  >
    <span>
      {#if !projectOnly}<HoverTip tip={USER_COLUMN_TIP}>User</HoverTip>{/if}
    </span>
    <span
      ><HoverTip tip={projectColumnTip(projectName)}>{projectName}</HoverTip
      ></span
    >
  </div>
{/if}
