<script lang="ts">
import type { Snippet } from "svelte";
import type { UnreadableConversation } from "@nervekit/contracts/activity";
import Bell from "@lucide/svelte/icons/bell";
import BellOff from "@lucide/svelte/icons/bell-off";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import Popover, {
  PopoverHeader,
  PopoverCommandList,
  PopoverSection,
  filterCommandItems,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import NotificationEntry, {
  type NotificationEntryAction,
} from "./NotificationEntry.svelte";
import UnreadableConversationList from "./UnreadableConversationList.svelte";
import {
  notificationRank,
  notificationTime,
  type NotificationAction,
  type NotificationItem,
} from "./notifications";

let {
  items = [],
  error,
  unseenFailure = false,
  muted = false,
  attention,
  open = false,
  onOpenChange,
  onOpenItem,
  onAction,
  onDismiss,
  onDeleteConversations,
  onClearFinished,
  onToggleMute,
  onViewed,
}: {
  items?: NotificationItem[];
  error?: string;
  unseenFailure?: boolean;
  /** Sounds, toasts and pop-ups are muted in this window. */
  muted?: boolean;
  /** A persistent entry above the list (e.g. settings health); the bell shows a warning badge while it exists. */
  attention?: Snippet;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Navigate to the conversation behind an item; clicking such an item does this. */
  onOpenItem?: (item: NotificationItem) => void;
  onAction?: (
    intent: NotificationAction["intent"],
    item: NotificationItem,
  ) => void;
  onDismiss?: (id: string) => void;
  onDeleteConversations?: (entries: UnreadableConversation[]) => void;
  onClearFinished?: () => void;
  /** Mute for an hour, or unmute when already muted. */
  onToggleMute?: () => void;
  /** Called with the ids that have been on screen long enough to be read. */
  onViewed?: (ids: string[]) => void;
} = $props();

let query = $state("");
let expanded = $state<Record<string, boolean>>({});
const commandItems = $derived(
  items.map((item) => ({
    ...item,
    key: item.id,
    label: item.title,
    group:
      notificationRank(item) === 0
        ? "Needs attention"
        : notificationRank(item) === 1
          ? "Running"
          : "Finished",
    keywords: [item.context, item.detail ?? ""],
  })),
);

// The badge counts requests for input only; failures are grouped under
// "Needs attention" but surface through the red dot.
const needsYou = $derived(
  items.filter((item) => item.kind === "attention").length,
);
const running = $derived(
  items.filter((item) => item.kind === "running").length,
);
const finishedCount = $derived(
  items.filter((item) => notificationRank(item) === 2).length,
);
const unreadIds = $derived(
  filterCommandItems(commandItems, query)
    .flatMap((group) => group.items)
    .filter((item) => item.unread)
    .map((item) => item.id),
);
const unreadable = $derived(
  items.some((item) => item.unreadableConversations?.length),
);
const label = $derived(
  `Notifications${needsYou ? `, ${needsYou} need you` : running ? ", running" : ""}${unseenFailure ? ", unseen failure" : ""}${muted ? ", muted" : ""}${attention ? ", settings need attention" : unreadable ? ", conversations need attention" : ""}`,
);

// Ping the bell dot until the user has opened the notifications for the
// current attention state; a new needs-you item or notice re-arms it.
const attentionKey = $derived(
  needsYou || attention || unreadable
    ? `${needsYou}:${Boolean(attention)}:${unreadable}`
    : "",
);
let seenAttentionKey = $state("");
$effect(() => {
  if (open) seenAttentionKey = attentionKey;
});
const ping = $derived(
  !muted && attentionKey !== "" && attentionKey !== seenAttentionKey,
);

let now = $state(Date.now());
$effect(() => {
  if (!open) return;
  now = Date.now();
  const timer = setInterval(
    () => {
      now = Date.now();
    },
    running ? 1000 : 30_000,
  );
  return () => clearInterval(timer);
});
// Unread dots clear shortly after the list has been on screen.
$effect(() => {
  if (!open || !unreadIds.length) return;
  const ids = unreadIds;
  const timer = setTimeout(() => onViewed?.(ids), 2000);
  return () => clearTimeout(timer);
});

/** Only items that lead somewhere are clickable; the rest act through their buttons and disclosure. */
function choose(item: NotificationItem): void {
  if (item.conversationId) onOpenItem?.(item);
}

function entryActions(item: NotificationItem): NotificationEntryAction[] {
  const actions: NotificationEntryAction[] = [];
  const unreadable = item.unreadableConversations ?? [];
  if (unreadable.length)
    actions.push({
      label: unreadable.length === 1 ? "Delete" : "Delete all",
      destructive: true,
      onSelect: () => onDeleteConversations?.(unreadable),
    });
  // "Open" is the row click itself, so only work-changing actions get buttons.
  if (item.action && item.action.intent !== "open") {
    const intent = item.action.intent;
    actions.push({
      label: item.action.label,
      onSelect: () => onAction?.(intent, item),
    });
  }
  return actions;
}

const childLabel = {
  done: "Done",
  running: "Running",
  queued: "Queued",
  failed: "Failed",
};
</script>

<Popover
  {open}
  size="lg"
  align="end"
  ariaLabel={label}
  triggerTitle="Notifications"
  onOpenChange={(next) => {
    query = "";
    onOpenChange?.(next);
  }}
>
  {#snippet triggerChild({ props })}
    <Button
      {...props}
      variant="ghost"
      size="icon"
      class="relative"
      ariaLabel={label}
    >
      {#if muted}<BellOff
          class="size-4"
          aria-hidden="true"
        />{:else if !needsYou && running}<Spinner class="size-4" />{:else}<Bell
          class="size-4"
          aria-hidden="true"
        />{/if}
      {#if needsYou}
        <span
          class={[
            "absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-warning px-1 text-center text-caption leading-4 text-warning",
            ping && "attention-ping",
          ]}
          aria-hidden="true"
          ><span class="relative z-10 text-warning-foreground">{needsYou}</span
          ></span
        >
      {/if}
      {#if (attention || unreadable) && !needsYou}
        <span
          class={[
            "absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning text-warning",
            ping && "attention-ping",
          ]}
          aria-hidden="true"
        ></span>
      {/if}
      {#if unseenFailure}
        <span
          class="absolute bottom-1 right-1 size-1.5 rounded-full bg-destructive-solid"
          aria-hidden="true"
        ></span>
      {/if}
    </Button>
  {/snippet}
  <PopoverHeader
    title="Notifications"
    meta={needsYou ? `${needsYou} need you` : undefined}
  >
    {#snippet actions()}
      <Button variant="ghost" size="sm" onclick={() => onToggleMute?.()}
        >{muted ? "Unmute" : "Mute 1 h"}</Button
      >
      <Button
        variant="ghost"
        size="sm"
        disabled={!finishedCount}
        onclick={() => onClearFinished?.()}>Clear finished</Button
      >
    {/snippet}
  </PopoverHeader>
  <PopoverCommandList
    items={commandItems}
    bind:query
    rowMode="container"
    placeholder="Search notifications"
    ariaLabel="Notifications"
    leading={error || attention ? notices : undefined}
    onChoose={choose}
    empty={items.length
      ? "No notifications match your search."
      : "You're all caught up"}
  >
    {#snippet row(item)}
      {@render notification(item)}
    {/snippet}
  </PopoverCommandList>
</Popover>

{#snippet notices()}
  {#if !query}
    <PopoverSection label="System">
      {#if error}
        <div role="alert">
          <NotificationEntry
            tone="failed"
            title="Notifications couldn't update"
            detail={error}
          />
        </div>
      {/if}
      {#if attention}{@render attention()}{/if}
    </PopoverSection>
  {/if}
{/snippet}

{#snippet notification(item: NotificationItem)}
  {@const unreadable = item.unreadableConversations ?? []}
  <NotificationEntry
    tone={item.kind}
    title={item.title}
    context={item.context}
    detail={item.detail}
    time={notificationTime(item, now)}
    unread={item.unread}
    interactive={!!item.conversationId}
    progress={item.progress
      ? item.progress.total
        ? Math.min(100, (item.progress.completed / item.progress.total) * 100)
        : 0
      : undefined}
    actions={entryActions(item)}
    onDismiss={notificationRank(item) === 2
      ? () => onDismiss?.(item.id)
      : undefined}
    disclosure={unreadable.length
      ? `${unreadable.length} conversation${unreadable.length === 1 ? "" : "s"}`
      : item.children.length
        ? `${item.children.length} step${item.children.length === 1 ? "" : "s"}`
        : undefined}
    bind:expanded={
      () => expanded[item.id] ?? false, (next) => (expanded[item.id] = next)
    }
  >
    {#if unreadable.length}
      <UnreadableConversationList
        entries={unreadable}
        onDelete={(entries) => onDeleteConversations?.(entries)}
      />
    {:else if item.children.length}
      <ul class="mt-1 grid gap-0.5 border-l pl-2">
        {#each item.children as child (child.id)}
          <li class="flex items-center gap-1.5 text-ui">
            {#if child.status === "done"}<CircleCheck
                class="size-3 text-success"
                aria-hidden="true"
              />{:else if child.status === "running"}<Spinner
                class="size-3"
              />{:else if child.status === "failed"}<CircleAlert
                class="size-3 text-destructive"
                aria-hidden="true"
              />{:else}<CircleDashed
                class="size-3 text-muted-foreground"
                aria-hidden="true"
              />{/if}
            <span class="min-w-0 flex-1 truncate">{child.title}</span>
            <span class="text-muted-foreground">{childLabel[child.status]}</span
            >
          </li>
        {/each}
      </ul>
    {/if}
  </NotificationEntry>
{/snippet}
