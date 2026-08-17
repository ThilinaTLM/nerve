<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  children?: Snippet;
};

let { children }: Props = $props();
</script>

<div class="min-w-0 divide-y overflow-hidden rounded-sm border bg-sidebar">
  {#if children}{@render children()}{/if}
</div>
