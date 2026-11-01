<script lang="ts" module>
export type SettingsStat = {
  label: string;
  value: string;
  wide?: boolean;
  /** Paths and identifiers; monospace is only for code, logs and paths. */
  mono?: boolean;
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
        "grid min-w-0 gap-0.5 rounded-md bg-muted px-2.5 py-2",
        item.wide && "md:col-span-2",
      )}
    >
      <span class="truncate text-caption text-muted-foreground"
        >{item.label}</span
      >
      <span
        class={cn(
          "truncate text-ui text-foreground",
          item.mono && "font-mono text-ui",
        )}
        title={item.value}>{item.value}</span
      >
    </div>
  {/each}
</div>
