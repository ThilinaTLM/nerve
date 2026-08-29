<script lang="ts" module>
export type SettingsStat = {
  label: string;
  value: string;
  wide?: boolean;
};
</script>

<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  items: SettingsStat[];
  class?: string;
};

let { items, class: className }: Props = $props();
</script>

<div class={cn("grid grid-cols-1 gap-2 md:grid-cols-2", className)}>
  {#each items as item (item.label)}
    <div
      class={cn(
        "grid min-w-0 gap-0.5 rounded-md border border-border/50 px-2.5 py-2",
        item.wide && "md:col-span-2",
      )}
    >
      <span
        class="font-mono text-xs tracking-wide text-muted-foreground uppercase"
        >{item.label}</span
      >
      <span class="truncate font-mono text-xs font-medium text-foreground"
        >{item.value}</span
      >
    </div>
  {/each}
</div>
