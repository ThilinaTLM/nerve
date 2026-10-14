<script lang="ts">
import type { Snippet } from "svelte";

/** A titled cluster of specimens inside a gallery section. */
let {
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: Snippet;
} = $props();
</script>

<section class="flex flex-col gap-4">
  <header class="flex flex-col gap-0.5 border-b pb-2">
    <h2 class="text-base font-semibold text-foreground">{title}</h2>
    {#if description}
      <p class="text-xs text-muted-foreground">{description}</p>
    {/if}
  </header>
  <div class="flex flex-col gap-6">
    {@render children()}
  </div>
</section>
