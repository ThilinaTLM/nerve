<script lang="ts">
import ImageOff from "@lucide/svelte/icons/image-off";
let {
  src,
  alt,
  class: className,
}: { src: string; alt: string; class?: string } = $props();
let failedSource = $state<string>();
</script>

{#if failedSource === src}
  <div
    role="img"
    aria-label="Image unavailable"
    class="flex min-h-24 items-center justify-center gap-2 rounded-sm border bg-well p-4 text-ui text-muted-foreground"
  >
    <ImageOff class="size-4" aria-hidden="true" />
    <span>Image unavailable</span>
  </div>
{:else}
  <img
    class={className}
    {src}
    {alt}
    onerror={() => {
      failedSource = src;
    }}
  />
{/if}
