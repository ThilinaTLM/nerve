<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import ImageFrame from "./ImageFrame.svelte";

type Props = {
  /**
   * `list` mimics result rows, `text` a code/output block, `links` link rows
   * (web search) and `image` an aspect-reserved picture frame.
   */
  variant?: "list" | "text" | "image" | "links";
  rows?: number;
  /** Image size like `1024x576`; sets the reserved frame's aspect ratio. */
  ratio?: string;
};

let { variant = "list", rows = 3, ratio }: Props = $props();

const bars = $derived(Array.from({ length: Math.max(1, rows) }, (_, i) => i));

function aspect(size: string | undefined): number {
  const match = /^(\d+)\s*[x×:]\s*(\d+)$/i.exec(size?.trim() ?? "");
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 1;
}
const textWidths = ["w-full", "w-2/3"];
</script>

<!-- Placeholder silhouette for a result section while a tool call executes.
     It is a sheet section itself and carries no border of its own. -->
{#if variant === "image"}
  <div aria-hidden="true">
    <ImageFrame ratio={aspect(ratio)} ready={false} />
  </div>
{:else if variant === "links"}
  <div aria-hidden="true">
    {#each bars as bar (bar)}
      <div class="grid gap-1 px-2.5 py-1.5">
        <div class="flex min-w-0 items-center gap-2">
          <Skeleton class="h-2.5 w-4 flex-none rounded-sm" />
          <Skeleton class="h-2.5 flex-1 rounded-sm" />
          <Skeleton class="h-2.5 w-20 flex-none rounded-sm" />
        </div>
        <div class="grid gap-1 pl-6">
          <Skeleton class="h-2.5 w-full rounded-sm" />
          <Skeleton class="h-2.5 w-3/4 rounded-sm" />
        </div>
      </div>
    {/each}
  </div>
{:else if variant === "list"}
  <div aria-hidden="true">
    {#each bars as bar (bar)}
      <div class="px-2.5 py-2">
        <Skeleton class="h-5 w-full rounded-sm" />
      </div>
    {/each}
  </div>
{:else}
  <div class="grid gap-1.5 px-2.5 py-2" aria-hidden="true">
    {#each bars as bar (bar)}
      <Skeleton class={`h-3 ${textWidths[bar % 2]}`} />
    {/each}
  </div>
{/if}
