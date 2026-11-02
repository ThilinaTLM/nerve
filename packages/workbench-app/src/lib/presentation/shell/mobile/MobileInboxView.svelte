<script lang="ts">
import type { Snippet } from "svelte";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import ClockAlert from "@lucide/svelte/icons/clock-alert";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import MobileListRow from "./MobileListRow.svelte";
import MobileSection from "./MobileSection.svelte";
import {
  inboxSupportingLine,
  type MobileInboxItem,
  type MobileInboxModel,
} from "./mobile-inbox.js";
import type { MobileRowSwipeAction } from "./mobile-swipe.js";

/**
 * Triage screen body: what wants a human, then what is still moving, then the
 * latest quiet conversations so picking a thread back up is one tap.
 */
let {
  model,
  onOpen,
  rowActions,
  summary,
}: {
  model: MobileInboxModel;
  onOpen: (item: MobileInboxItem) => void;
  /** Per-item sheet items and swipe actions, mirroring the conversation menu. */
  rowActions?: (item: MobileInboxItem) => {
    menuItems: ContextMenuItem[];
    swipeLeading?: MobileRowSwipeAction;
    swipeTrailing?: MobileRowSwipeAction[];
  };
  /** Banner rendered above the lists. */
  summary?: Snippet;
} = $props();

const caughtUp = $derived(
  model.needsYou.length === 0 &&
    model.running.length === 0 &&
    model.awaitingAsync.length === 0,
);

function age(item: MobileInboxItem): string | undefined {
  return item.at ? relativeTimeLabel(item.at) : undefined;
}
</script>

{#snippet row(item: MobileInboxItem, withSignal: boolean)}
  {@const actions = rowActions?.(item)}
  <MobileListRow
    title={item.title}
    detail={inboxSupportingLine(item)}
    meta={age(item)}
    tone={withSignal ? item.tone : "neutral"}
    pulse={withSignal && item.pulse}
    chevron={false}
    menuItems={actions?.menuItems}
    menuTitle={item.title}
    swipeLeading={actions?.swipeLeading}
    swipeTrailing={actions?.swipeTrailing}
    onclick={() => onOpen(item)}
  />
{/snippet}

{#if summary}{@render summary()}{/if}

{#if model.needsYou.length}
  <MobileSection title="Needs you" meta={`${model.needsYou.length}`}>
    {#each model.needsYou as item (item.id)}
      {@render row(item, true)}
    {/each}
  </MobileSection>
{/if}

{#if model.awaitingAsync.length}
  <MobileSection
    title="Waiting for background work"
    meta={`${model.awaitingAsync.length}`}
  >
    {#each model.awaitingAsync as item (item.id)}
      {@const actions = rowActions?.(item)}
      <MobileListRow
        title={item.title}
        detail={inboxSupportingLine(item)}
        meta={age(item)}
        chevron={false}
        menuItems={actions?.menuItems}
        menuTitle={item.title}
        swipeLeading={actions?.swipeLeading}
        swipeTrailing={actions?.swipeTrailing}
        onclick={() => onOpen(item)}
      >
        {#snippet leading()}
          <ClockAlert
            class="mt-1 -mr-1.5 size-3.5 flex-none text-info"
            aria-label="Waiting for background work"
          />
        {/snippet}
      </MobileListRow>
    {/each}
  </MobileSection>
{/if}

{#if model.running.length}
  <MobileSection title="Running" meta={`${model.running.length}`}>
    {#each model.running as item (item.id)}
      {@render row(item, true)}
    {/each}
  </MobileSection>
{/if}

{#if caughtUp}
  <Empty.Root class="px-6 py-10">
    <Empty.Header>
      <Empty.Media class="text-success">
        <CircleCheck size={28} strokeWidth={1.6} />
      </Empty.Media>
      <Empty.Title class="text-ui">Nothing needs you</Empty.Title>
      <Empty.Description class="text-ui">
        Approvals, questions, plan reviews and agent errors land here.
      </Empty.Description>
    </Empty.Header>
  </Empty.Root>
{/if}

{#if model.recent.length}
  <MobileSection title="Recent">
    {#each model.recent as item (item.id)}
      {@render row(item, false)}
    {/each}
  </MobileSection>
{/if}
