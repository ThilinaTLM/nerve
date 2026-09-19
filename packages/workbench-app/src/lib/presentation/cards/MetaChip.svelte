<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { cn } from "@nervekit/ui-kit/utils";
import type { MetaItem } from "./card-presentation";

type Props = {
  item: MetaItem;
  onOpenFile?: (path: string, line?: number) => void;
};

let { item, onOpenFile }: Props = $props();

const toneClass: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  accent: "text-muted-foreground",
  info: "border-info/35 text-info",
  success: "border-success/35 text-success",
  warning: "border-warning/35 text-warning",
  destructive: "border-destructive/35 text-destructive",
};

const chipClass = $derived(
  cn(
    "inline-flex min-h-5 items-center rounded-sm border border-border bg-well px-1.5 py-0.5 text-xs leading-none font-medium whitespace-nowrap tabular-nums no-underline",
    toneClass[item.tone ?? "neutral"],
    item.mono && "font-mono",
    (item.openPath || item.href) && "cursor-pointer hover:underline",
  ),
);
</script>

{#if item.openPath}
  <button
    class={chipClass}
    type="button"
    title={item.openPath}
    onclick={() => onOpenFile?.(item.openPath!)}>{item.text}</button
  >
{:else if item.href}
  <a
    class={chipClass}
    href={item.href}
    target="_blank"
    rel="noreferrer noopener">{item.text}</a
  >
{:else}
  <span class={chipClass}>{item.text}</span>
{/if}
