<script lang="ts">
import type { Snippet } from "svelte";
import { prefersReducedMotion } from "svelte/motion";
import { scale } from "svelte/transition";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { CardAction, MetaItem } from "./card-presentation";
import MetaChip from "./MetaChip.svelte";
import { ChipOrder, chipKey } from "./chip-order";

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

// Chips are append-only: ordered by first appearance, keyed by identity, and
// only animated on enter (no position animation when others change).
const chipOrder = new ChipOrder();
const orderedMeta = $derived(chipOrder.order(meta));

const hasActions = $derived(Boolean(actions));
const hasPrimaryAction = $derived(Boolean(primaryAction));
const hasRight = $derived(
  cardActions.length > 0 || hasPrimaryAction || hasActions,
);
const show = $derived(
  meta.length > 0 || cardActions.length > 0 || hasPrimaryAction || hasActions,
);
</script>

{#if show}
  <div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
    {#if meta.length > 0}
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        {#each orderedMeta as item (chipKey(item))}
          <span
            class="inline-flex"
            in:scale={{
              duration: prefersReducedMotion.current ? 0 : 200,
              start: 0.85,
            }}
          >
            <MetaChip {item} {onOpenFile} />
          </span>
        {/each}
      </div>
    {/if}
    {#if hasRight}
      <div
        class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
      >
        {#each cardActions as action, i (i)}
          <Badge
            variant="neutral"
            class="max-w-full min-w-0 flex-[0_1_auto] text-left tabular-nums [overflow-wrap:anywhere]"
            aria-label={action.ariaLabel}
            onclick={action.onClick}
          >
            {action.label}
          </Badge>
        {/each}
        {#if primaryAction}
          <Button
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
