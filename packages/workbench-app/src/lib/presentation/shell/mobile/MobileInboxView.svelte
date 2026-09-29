<script lang="ts">
import type { Snippet } from "svelte";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Hourglass from "@lucide/svelte/icons/hourglass";
import MessageSquare from "@lucide/svelte/icons/message-square";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import MobileListRow from "./MobileListRow.svelte";
import MobileSection from "./MobileSection.svelte";
import type { MobileInboxItem, MobileInboxModel } from "./mobile-inbox.js";

/**
 * Triage screen body: what wants a human, then what is still moving, then the
 * latest quiet conversations so picking a thread back up is one tap.
 */
let {
  model,
  onOpen,
  menuItems,
  summary,
}: {
  model: MobileInboxModel;
  onOpen: (item: MobileInboxItem) => void;
  /** Per-item actions, mirroring the conversation list menu. */
  menuItems?: (item: MobileInboxItem) => ContextMenuItem[];
  /** Connection, usage and repository chips rendered above the lists. */
  summary?: Snippet;
} = $props();

const caughtUp = $derived(
  model.needsYou.length === 0 &&
    model.running.length === 0 &&
    model.awaitingAsync.length === 0,
);

// The row meta line answers "where and when" in one glance.
function rowMeta(item: MobileInboxItem): string {
  const age = item.at ? relativeTimeLabel(item.at) : "";
  return [item.projectLabel, age].filter(Boolean).join(" · ");
}

// Errors and runs already read as a state; only requests need naming.
function rowDetail(item: MobileInboxItem): string {
  if (
    item.kind === "error" ||
    item.kind === "running" ||
    item.kind === "awaiting-async" ||
    item.kind === "recent"
  )
    return item.detail;
  return `${item.kindLabel} · ${item.detail}`;
}
</script>

{#if summary}{@render summary()}{/if}

{#if model.needsYou.length}
  <MobileSection title="Needs you" meta={`${model.needsYou.length}`}>
    {#each model.needsYou as item (item.id)}
      <MobileListRow
        title={item.title}
        detail={rowDetail(item)}
        meta={rowMeta(item)}
        tone={item.tone}
        pulse={item.pulse}
        menuItems={menuItems?.(item)}
        menuTitle={item.title}
        onclick={() => onOpen(item)}
      />
    {/each}
  </MobileSection>
{/if}

{#if model.awaitingAsync.length}
  <MobileSection
    title="Waiting for background work"
    meta={`${model.awaitingAsync.length}`}
  >
    {#each model.awaitingAsync as item (item.id)}
      <MobileListRow
        title={item.title}
        detail={item.detail}
        meta={rowMeta(item)}
        menuItems={menuItems?.(item)}
        menuTitle={item.title}
        onclick={() => onOpen(item)}
      >
        {#snippet leading()}
          <Hourglass
            class="mt-1 size-3.5 flex-none text-warning"
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
      <MobileListRow
        title={item.title}
        detail={item.detail}
        meta={rowMeta(item)}
        tone={item.tone}
        pulse={item.pulse}
        menuItems={menuItems?.(item)}
        menuTitle={item.title}
        onclick={() => onOpen(item)}
      />
    {/each}
  </MobileSection>
{/if}

{#if caughtUp}
  <Empty.Root class="px-6 py-10">
    <Empty.Header>
      <Empty.Media class="text-success">
        <CircleCheck size={28} strokeWidth={1.6} />
      </Empty.Media>
      <Empty.Title class="text-sm">Nothing needs you</Empty.Title>
      <Empty.Description class="text-xs">
        Approvals, questions, plan reviews and agent errors land here.
      </Empty.Description>
    </Empty.Header>
  </Empty.Root>
{/if}

{#if model.recent.length}
  <MobileSection title="Recent">
    {#each model.recent as item (item.id)}
      <MobileListRow
        title={item.title}
        meta={rowMeta(item)}
        icon={MessageSquare}
        menuItems={menuItems?.(item)}
        menuTitle={item.title}
        onclick={() => onOpen(item)}
      />
    {/each}
  </MobileSection>
{/if}
