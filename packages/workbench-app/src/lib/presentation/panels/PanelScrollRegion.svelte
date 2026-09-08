<script lang="ts">
import type { Snippet } from "svelte";
import { ItemScrollRegion } from "$lib/presentation/items";

let {
  viewport = $bindable(),
  ariaLabel,
  contentClass,
  topShadowClass,
  children,
}: {
  viewport?: HTMLDivElement;
  ariaLabel?: string;
  contentClass?: string;
  topShadowClass?: string;
  children: Snippet;
} = $props();
</script>

<ItemScrollRegion bind:viewport {ariaLabel} {contentClass} {topShadowClass}>
  {@render children()}
</ItemScrollRegion>
