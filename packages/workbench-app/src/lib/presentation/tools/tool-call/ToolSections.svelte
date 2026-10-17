<script lang="ts">
// Result views render their parts as sibling sections. Inside a card the
// sections join the card's sheet (hairline between each); standalone, such as
// in the details dialog, they get a sheet of their own.
import type { Snippet } from "svelte";
import CardSheet from "../../cards/CardSheet.svelte";
import { inCardSheet } from "../../cards/sheet-context";

let { children }: { children: Snippet } = $props();

const inSheet = inCardSheet();
</script>

{#if inSheet}
  {@render children()}
{:else}
  <CardSheet>{@render children()}</CardSheet>
{/if}
