<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { ItemSurface } from "$lib/presentation/items";
</script>

<ItemSurface
  role="status"
  ariaLabel="Loading pull requests"
  class="flex-col gap-1 px-3 py-2.5"
>
  <div class="flex min-w-0 items-center gap-1.5">
    <Skeleton class="h-3.5 w-7 shrink-0" />
    <Skeleton class="h-3.5 w-3/4" />
  </div>
  <div class="flex min-w-0 items-center gap-1">
    <Skeleton class="h-5 w-20 rounded-full" />
    <Skeleton class="ml-auto size-6 rounded-sm" />
  </div>
  <span class="sr-only">Loading pull requests</span>
</ItemSurface>
