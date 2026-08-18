<script lang="ts">
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  label,
  value,
  mono = false,
  class: className,
}: {
  label: string;
  value: string;
  /** Render the value in monospace (for ids/keys/paths). */
  mono?: boolean;
  class?: string;
} = $props();
</script>

<div
  class={cn(
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5",
    className,
  )}
>
  <span class="truncate text-xs text-muted-foreground">{label}</span>
  <span
    class={cn(
      "truncate text-xs font-medium text-foreground",
      mono && "font-mono",
    )}>{value}</span
  >
</div>
