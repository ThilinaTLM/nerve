<script lang="ts">
import type { Snippet } from "svelte";
import { ItemScrollRegion } from "$lib/presentation/items";

let {
  viewport = $bindable(),
  activeKey,
  ariaLabel,
  contentClass,
  children,
}: {
  viewport?: HTMLDivElement;
  activeKey?: string;
  ariaLabel?: string;
  contentClass?: string;
  children: Snippet;
} = $props();
</script>

<ItemScrollRegion bind:viewport {activeKey} {ariaLabel} {contentClass}>
  {@render children()}
</ItemScrollRegion>
