<script lang="ts">
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
</script>

<div
  role="status"
  aria-label="Loading pull requests"
  class="flex min-w-0 flex-col gap-1 rounded-md bg-accent/35 px-3 py-2.5 ring-1 ring-border ring-inset"
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
</div>
