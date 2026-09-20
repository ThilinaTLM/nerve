<script lang="ts">
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import type { CardAction, MetaItem } from "./card-presentation";
import MetaChip from "./MetaChip.svelte";

type Props = {
  meta?: MetaItem[];
  /** Right-aligned pills, e.g. "Open task" then "View details". */
  cardActions?: CardAction[];
  /** Recovery-critical action rendered as a primary control. */
  primaryAction?: CardAction;
  onOpenFile?: (path: string, line?: number) => void;
  /** Right-aligned action buttons (e.g. HIL accept/reject, reply/dismiss). */
  actions?: Snippet;
};
let {
  meta = [],
  cardActions = [],
  primaryAction,
  onOpenFile,
  actions,
}: Props = $props();

const hasActions = $derived(Boolean(actions));
const hasPrimaryAction = $derived(Boolean(primaryAction));
const show = $derived(
  meta.length > 0 || cardActions.length > 0 || hasPrimaryAction || hasActions,
);
</script>

{#if show}
  <div class="flex min-w-0 flex-wrap items-start gap-x-2.5 gap-y-1.5">
    {#if meta.length > 0}
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        {#each meta as item, i (i)}
          <MetaChip {item} {onOpenFile} />
        {/each}
      </div>
    {/if}
    {#if cardActions.length > 0}
      <div
        class={cn(
          "flex min-w-0 flex-wrap items-center gap-1.5",
          hasActions || hasPrimaryAction ? "ml-0" : "ml-auto",
        )}
      >
        {#each cardActions as action, i (i)}
          <button
            class="inline-flex min-h-5 max-w-full min-w-0 flex-[0_1_auto] cursor-pointer items-center rounded-sm border border-border bg-well px-1.5 py-0.5 text-left text-xs leading-none font-medium text-primary tabular-nums [overflow-wrap:anywhere] hover:underline"
            type="button"
            aria-label={action.ariaLabel}
            onclick={action.onClick}
          >
            {action.label}
          </button>
        {/each}
      </div>
    {/if}
    {#if primaryAction || actions}
      <div
        class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
      >
        {#if primaryAction}
          <Button
            size="sm"
            aria-label={primaryAction.ariaLabel}
            onclick={primaryAction.onClick}
          >
            {primaryAction.label}
          </Button>
        {/if}
        {#if actions}{@render actions()}{/if}
      </div>
    {/if}
  </div>
{/if}
