<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  id: string;
  title: string;
  trailing?: Snippet;
  children: Snippet;
};

let { id, title, trailing, children }: Props = $props();
</script>

<section class="grid gap-2" aria-labelledby={id}>
  <div class="flex min-h-6 items-center justify-between gap-3">
    <h2 {id} class="text-sm font-semibold text-foreground">{title}</h2>
    {#if trailing}
      <div class="flex shrink-0 items-center gap-2">{@render trailing()}</div>
    {/if}
  </div>
  {@render children()}
</section>
