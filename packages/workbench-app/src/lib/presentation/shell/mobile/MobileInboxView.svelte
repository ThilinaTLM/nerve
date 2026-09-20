<script lang="ts">
import type { Snippet } from "svelte";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import MobileListRow from "./MobileListRow.svelte";
import MobileSection from "./MobileSection.svelte";
import type { MobileInboxItem, MobileInboxModel } from "./mobile-inbox.js";

/** Triage screen body: what wants a human, then what is still moving. */
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

const empty = $derived(
  model.needsYou.length === 0 && model.running.length === 0,
);

// The row meta line answers "where and when" in one glance.
function rowMeta(item: MobileInboxItem): string {
  const age = item.at ? relativeTimeLabel(item.at) : "";
  return [item.projectLabel, age].filter(Boolean).join(" · ");
}

// Errors and runs already read as a state; only requests need naming.
function rowDetail(item: MobileInboxItem): string {
  if (item.kind === "error" || item.kind === "running") return item.detail;
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

{#if empty}
  <div class="grid justify-items-center gap-2 px-6 py-12 text-center">
    <CircleCheck class="text-success" size={28} strokeWidth={1.6} />
    <p class="text-sm text-foreground">Nothing needs you</p>
    <p class="text-xs text-muted-foreground">
      Approvals, questions, plan reviews and agent errors land here.
    </p>
  </div>
{/if}
