<script lang="ts">
import type { Snippet } from "svelte";

/** Titled group of mobile rows: one bordered card, hairline-divided rows. */
let {
  title,
  meta,
  children,
}: {
  title?: string;
  meta?: string;
  children: Snippet;
} = $props();
</script>

<section class="grid gap-1.5 px-3 py-2">
  {#if title}
    <h2 class="flex items-baseline gap-2 px-1">
      <span class="text-sm font-semibold text-foreground">{title}</span>
      {#if meta}<span class="text-xs text-muted-foreground">{meta}</span>{/if}
    </h2>
  {/if}
  <div class="mobile-section-card">
    {@render children()}
  </div>
</section>

<style>
.mobile-section-card {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card);
}

.mobile-section-card > :global(* + *) {
  border-top: 1px solid var(--border);
}
</style>
