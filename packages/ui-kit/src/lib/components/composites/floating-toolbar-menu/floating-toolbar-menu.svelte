<script lang="ts">
import type { Component, Snippet } from "svelte";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { FloatingToolbarButton } from "@nervekit/ui-kit/components/composites/floating-toolbar";

type Props = {
  /** Tooltip and accessible name of the trigger. */
  label?: string;
  icon?: Component<{ class?: string; "aria-hidden"?: boolean | "true" }>;
  /** `DropdownMenu` items. */
  children: Snippet;
};

let { label = "More actions", icon = Ellipsis, children }: Props = $props();
</script>

<!-- Secondary actions of a floating bar behind one trigger. Keep 4–8 controls
     visible on the bar; the rest, and the actions of `collapse` groups, go
     here. -->
<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <FloatingToolbarButton {...props} {label} {icon} />
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    {@render children()}
  </DropdownMenu.Content>
</DropdownMenu.Root>
