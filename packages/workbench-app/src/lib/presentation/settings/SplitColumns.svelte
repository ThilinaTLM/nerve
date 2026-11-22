<!--
  Quiet labels over the two halves of LayerRow's split layout, on the line
  above the section's card (`SettingsSection` `splitLabels`). Each label sits
  at the left edge of its half. While the project's settings file is untrusted
  the project label carries one lock.
-->
<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import HoverTip from "./HoverTip.svelte";
import {
  lockedColumnTip,
  projectColumnTip,
  USER_COLUMN_TIP,
} from "./settings-origin";

let {
  projectName,
  projectOnly = false,
  locked = false,
}: { projectName: string; projectOnly?: boolean; locked?: boolean } = $props();
</script>

<!-- Row padding (px-3) plus the card's 1px border. -->
<div
  class="grid grid-cols-2 gap-3 px-[calc(--spacing(3)+1px)] text-caption text-muted-foreground"
>
  <span class="flex min-w-0">
    {#if !projectOnly}<HoverTip tip={USER_COLUMN_TIP}>User</HoverTip>{/if}
  </span>
  <span class="flex min-w-0">
    <HoverTip
      tip={locked
        ? lockedColumnTip(projectName)
        : projectColumnTip(projectName)}
    >
      <span class="flex items-center gap-1"
        >{#if locked}<Lock
            class="size-3 flex-none"
            aria-hidden="true"
          />{/if}{projectName}</span
      >
    </HoverTip>
  </span>
</div>
