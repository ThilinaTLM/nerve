<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";

type Props = { rows?: number; card?: boolean; label?: string };
let { rows = 4, card = true, label = "Loading section" }: Props = $props();
</script>

<div
  class={card
    ? "flex flex-col gap-2 rounded-md border border-border/60 bg-card px-3 py-3"
    : "flex flex-col gap-2 px-3 py-3"}
  role="status"
  aria-label={label}
>
  <Skeleton class="h-3 w-1/3" />
  {#each Array.from({ length: rows }, (_, index) => index) as index (index)}
    <Skeleton class={index % 3 === 2 ? "h-3 w-2/3" : "h-3 w-full"} />
  {/each}
  <span class="sr-only">{label}</span>
</div>
