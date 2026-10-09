<script lang="ts">
import {
  VirtualScroller,
  type VirtualScrollerController,
} from "@nervekit/ui-kit/components/composites/virtual-list";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type {
  QueuedInput,
  ConversationSummary,
} from "@nervekit/contracts/core";
import type { CoreTimelineRow } from "../state/transcript-types";
import type {
  ConversationPaneActions,
  ConversationMenuBuilders,
} from "../conversations/conversation-view-contracts";
import TranscriptRow from "./TranscriptRow.svelte";
import QueuedPromptRow from "./QueuedPromptRow.svelte";
let {
  rows,
  queuedPrompts = [],
  children = [],
  actions = {},
  menus,
  sending = false,
  hasOlder = false,
  loadingOlder = false,
  controller = $bindable(),
  atEnd = $bindable(true),
  followBottom = true,
  heightCacheKey,
}: {
  rows: CoreTimelineRow[];
  queuedPrompts?: QueuedInput[];
  children?: ConversationSummary[];
  actions?: ConversationPaneActions;
  menus?: ConversationMenuBuilders;
  sending?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  controller?: VirtualScrollerController;
  atEnd?: boolean;
  followBottom?: boolean;
  heightCacheKey?: string;
} = $props();
type Row =
  | { kind: "timeline"; key: string; row: CoreTimelineRow }
  | { kind: "queue"; key: string; input: QueuedInput }
  | { kind: "older" | "activity"; key: string };
const items = $derived<Row[]>([
  ...(hasOlder ? [{ kind: "older" as const, key: "older" }] : []),
  ...rows.map((row) => ({ kind: "timeline" as const, key: row.key, row })),
  ...queuedPrompts.map((input) => ({
    kind: "queue" as const,
    key: `queue:${input.inputId}`,
    input,
  })),
  ...(sending ? [{ kind: "activity" as const, key: "activity" }] : []),
]);
$effect(() => {
  const viewport = controller?.getViewportElement();
  if (!viewport) return;
  const load = () => {
    if (viewport.scrollTop < 60 && hasOlder && !loadingOlder)
      actions.onLoadOlder?.();
  };
  viewport.addEventListener("scroll", load, { passive: true });
  return () => viewport.removeEventListener("scroll", load);
});
</script>
<div class="relative h-full min-h-0 overflow-hidden">
  <VirtualScroller
    bind:controller
    bind:atEnd
    {heightCacheKey}
    {items}
    getKey={(item) => item.key}
    getMeasurementVersion={(item) =>
      item.kind === "timeline"
        ? JSON.stringify(item.row)
        : item.kind === "queue"
          ? item.input.inputId
          : item.key}
    estimateSize={() => 120}
    overscan={10}
    anchor="end"
    followOutput={followBottom}
    scrollEndThreshold={32}
    paddingStart={12}
    paddingEnd={18}
    gap={2}
    viewportTabIndex={0}
    viewportAriaLabel="Conversation transcript"
    viewportClass="@container h-full px-3"
  >
    {#snippet row({ item })}
      {#if item.kind === "older"}<div class="flex justify-center">
          <Button
            variant="ghost"
            size="xs"
            disabled={loadingOlder}
            onclick={actions.onLoadOlder}
            >{loadingOlder ? "Loading…" : "Load older messages"}</Button
          >
        </div>
      {:else if item.kind === "timeline"}<TranscriptRow
          row={item.row}
          {children}
          {actions}
          {menus}
        />
      {:else if item.kind === "queue"}<QueuedPromptRow
          prompt={item.input}
          onForcePush={actions.onForcePushQueuedPrompts}
          onDiscard={actions.onDiscardQueuedPrompt}
          onMoveToComposer={actions.onMoveQueuedPromptToComposer}
        />
      {:else}<p class="px-3 text-xs text-muted-foreground" aria-live="polite">
          Working…
        </p>{/if}
    {/snippet}
  </VirtualScroller>
</div>
