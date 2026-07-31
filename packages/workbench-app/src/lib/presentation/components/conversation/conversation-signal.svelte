<script lang="ts">
import type { Snippet } from "svelte";
import NerveBadge from "../brand/NerveBadge.svelte";

let {
  title,
  message,
  footer,
}: {
  title: string;
  message: string;
  footer?: Snippet;
} = $props();
</script>

<div class="flex h-full min-h-full items-center justify-center p-6 text-center">
  <div class="brand-signal-enter flex w-full max-w-xl flex-col items-center">
    <NerveBadge class="size-12" />

    <h2 class="mt-5 text-xl font-semibold tracking-tight text-foreground">
      {title}
    </h2>
    <p class="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
      {message}
    </p>

    {#if footer}
      <div class="mt-6 flex flex-col items-center">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>
