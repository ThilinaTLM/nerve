<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { cn } from "@nervekit/ui-kit/utils";
import type { MetaItem } from "./card-presentation";

type Props = {
  item: MetaItem;
  onOpenFile?: (path: string, line?: number) => void;
};

let { item, onOpenFile }: Props = $props();

const chipClass = $derived(cn("tabular-nums", item.mono && "font-mono"));
</script>

{#if item.openPath}
  <Badge
    variant={item.tone ?? "neutral"}
    class={chipClass}
    title={item.openPath}
    onclick={() => onOpenFile?.(item.openPath!)}>{item.text}</Badge
  >
{:else if item.href}
  <Badge
    variant={item.tone ?? "neutral"}
    class={chipClass}
    href={item.href}
    target="_blank"
    rel="noreferrer noopener">{item.text}</Badge
  >
{:else}
  <Badge variant={item.tone ?? "neutral"} class={chipClass}>{item.text}</Badge>
{/if}
