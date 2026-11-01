<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";

type Props = { label: string; rows?: number };
let { label, rows = 4 }: Props = $props();
</script>

<div
  class="flex max-w-3xl flex-col gap-3 px-4 py-4"
  role="status"
  aria-label={label}
>
  <Skeleton class="h-3 w-24" />
  {#each Array.from({ length: rows }, (_, index) => index) as index (index)}
    <Skeleton class={index % 3 === 2 ? "h-3 w-2/3" : "h-3 w-full"} />
  {/each}
  <span class="sr-only">{label}</span>
</div>
