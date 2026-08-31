<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";

type Variant =
  | "section"
  | "conversation"
  | "overview"
  | "merge"
  | "commits"
  | "checks";
type Props = {
  rows?: number;
  card?: boolean;
  label?: string;
  variant?: Variant;
};
let {
  rows = 4,
  card = true,
  label = "Loading section",
  variant = "section",
}: Props = $props();
</script>

<div
  class={card
    ? "flex flex-col gap-2 rounded-md border border-border/60 bg-card px-3 py-3"
    : "flex flex-col gap-2 px-3 py-3"}
  role="status"
  aria-label={label}
>
  {#if variant === "conversation"}
    <div class="flex items-center gap-2 border-b border-border/60 pb-2">
      <Skeleton class="size-5 rounded-full" />
      <Skeleton class="h-3 w-40" />
    </div>
    <Skeleton class="h-3 w-full" />
    <Skeleton class="h-3 w-11/12" />
    <Skeleton class="h-3 w-2/3" />
    <div class="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
      <Skeleton class="size-5 rounded-full" />
      <Skeleton class="h-3 w-32" />
    </div>
    <Skeleton class="h-3 w-4/5" />
  {:else if variant === "overview"}
    <Skeleton class="h-3 w-20" />
    {#each [0, 1, 2, 3] as row (row)}
      <div class="flex min-h-5 items-center gap-2">
        <Skeleton class="h-3 w-20" />
        <Skeleton class={row < 2 ? "h-5 w-24 rounded-full" : "h-3 w-28"} />
      </div>
    {/each}
  {:else if variant === "merge"}
    <Skeleton class="h-3 w-24" />
    <div class="flex items-center gap-2">
      <Skeleton class="size-4 rounded-full" />
      <Skeleton class="h-3 w-3/4" />
    </div>
    <Skeleton class="h-8 w-full rounded-md" />
  {:else if variant === "commits" || variant === "checks"}
    <Skeleton class="h-3 w-24" />
    {#each Array.from({ length: rows }, (_, index) => index) as index (index)}
      <div class="flex items-center gap-2 border-t border-border/60 pt-2">
        <Skeleton class="size-3.5 rounded-full" />
        <Skeleton class="h-3 flex-1" />
        <Skeleton class="h-3 w-16" />
        {#if variant === "checks"}<Skeleton
            class="h-5 w-14 rounded-full"
          />{/if}
      </div>
    {/each}
  {:else}
    <Skeleton class="h-3 w-1/3" />
    {#each Array.from({ length: rows }, (_, index) => index) as index (index)}
      <Skeleton class={index % 3 === 2 ? "h-3 w-2/3" : "h-3 w-full"} />
    {/each}
  {/if}
  <span class="sr-only">{label}</span>
</div>
