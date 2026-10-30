<script lang="ts">
import type { Snippet } from "svelte";
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import Ban from "@lucide/svelte/icons/ban";
import Bell from "@lucide/svelte/icons/bell";
import BellOff from "@lucide/svelte/icons/bell-off";
import BellRing from "@lucide/svelte/icons/bell-ring";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import X from "@lucide/svelte/icons/x";
import Popover, {
  PopoverHeader,
  PopoverBody,
  PopoverCommandList,
  PopoverViews,
  filterCommandItems,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
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
  /** Navigate to the conversation behind an item. */
  onOpenItem?: (item: NotificationItem) => void;
  onAction?: (
    intent: NotificationAction["intent"],
    item: NotificationItem,
  ) => void;
  onDismiss?: (id: string) => void;
  onClearFinished?: () => void;
  /** Mute for an hour, or unmute when already muted. */
  onToggleMute?: () => void;
  /** Called with the ids that have been on screen long enough to be read. */
  onViewed?: (ids: string[]) => void;
} = $props();

let query = $state("");
let selectedId = $state<string>();
const selectedItem = $derived(items.find((item) => item.id === selectedId));
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
  (selectedItem
    ? [selectedItem]
    : filterCommandItems(commandItems, query).flatMap((group) => group.items)
  )
    .filter((item) => item.unread)
    .map((item) => item.id),
);
const label = $derived(
  `Notifications${needsYou ? `, ${needsYou} need you` : running ? ", running" : ""}${unseenFailure ? ", unseen failure" : ""}${muted ? ", muted" : ""}${attention ? ", settings need attention" : ""}`,
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

const icons = {
  attention: BellRing,
  failed: CircleAlert,
  cancelled: Ban,
  succeeded: CircleCheck,
} as const;
const tones = {
  attention: "text-warning",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
  succeeded: "text-success",
} as const;
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
    selectedId = undefined;
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
          class="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-warning px-1 text-center text-[0.6875rem] leading-4 text-warning-foreground"
          aria-hidden="true">{needsYou}</span
        >
      {/if}
      {#if attention && !needsYou}
        <span
          class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning"
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
  {#if error || attention}
    <PopoverBody class="gap-0" ariaLabel="Notification notices">
      {#if error}<p role="alert" class="px-2 py-2 text-xs text-destructive">
          {error}
        </p>{/if}
      {#if attention}{@render attention()}{/if}
    </PopoverBody>
  {/if}
  <PopoverViews key={selectedItem?.id ?? "list"}>
    {#if selectedItem}
      <PopoverBody ariaLabel="Notification details">
        <Button
          variant="ghost"
          size="sm"
          class="justify-start"
          onclick={() => {
            selectedId = undefined;
          }}><ArrowLeft aria-hidden="true" />Back to notifications</Button
        >
        {@render notificationDetail(selectedItem)}
      </PopoverBody>
    {:else}
      <PopoverCommandList
        items={commandItems}
        bind:query
        placeholder="Search notifications"
        ariaLabel="Notifications"
        onChoose={(item) => {
          selectedId = item.id;
        }}
        empty={items.length
          ? "No notifications match your search."
          : "You're all caught up"}
      >
        {#snippet row(item)}
          <span class="flex min-w-0 items-start gap-2">
            {#if item.kind === "running"}
              <Spinner class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {:else}
              {@const Icon = icons[item.kind]}
              <Icon
                class="mt-0.5 size-4 shrink-0 {tones[item.kind]}"
                aria-hidden="true"
              />
            {/if}
            <span class="grid min-w-0 flex-1 gap-1">
              <span class="flex min-w-0 items-center gap-2"
                ><span class="min-w-0 flex-1 truncate text-sm"
                  >{item.title}</span
                >{#if item.unread}<span
                    class="size-1.5 rounded-full bg-info"
                    role="img"
                    aria-label="Unread"
                  ></span>{/if}<span
                  class="text-xs tabular-nums text-muted-foreground"
                  >{notificationTime(item, now)}</span
                ></span
              >
              <span class="truncate text-xs text-muted-foreground"
                >{item.context}</span
              >
              {#if item.progress}<Progress
                  value={item.progress.total
                    ? Math.min(
                        100,
                        (item.progress.completed / item.progress.total) * 100,
                      )
                    : 0}
                />{/if}
            </span>
            <ChevronRight
              class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
        {/snippet}
      </PopoverCommandList>
    {/if}
  </PopoverViews>
</Popover>

{#snippet notificationDetail(item: NotificationItem)}
  {@const finished = notificationRank(item) === 2}
  {@const clickable = item.conversationId !== undefined}
  <div
    class="group relative grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 rounded-md py-2 pl-0.5 pr-1 {clickable
      ? 'hover:bg-muted/60'
      : ''} {item.kind === 'succeeded' ? 'text-muted-foreground' : ''}"
  >
    {#if clickable}
      <button
        type="button"
        class="absolute inset-0 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`${item.title}: ${item.context}`}
        onclick={() => onOpenItem?.(item)}
      ></button>
    {/if}
    <span class="relative mt-0.5 flex-none">
      {#if item.kind === "running"}
        <Spinner class="size-4 text-muted-foreground" />
      {:else}
        {@const Icon = icons[item.kind]}
        <Icon class="size-4 {tones[item.kind]}" aria-hidden="true" />
      {/if}
      {#if item.unread}
        <span
          class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-info ring-2 ring-popover"
          role="img"
          aria-label="Unread"
        ></span>
      {/if}
    </span>
    <div class="min-w-0">
      <div class="flex items-center gap-1">
        <p class="min-w-0 flex-1 truncate text-sm">{item.title}</p>
        {#if item.action}
          <Button
            variant="ghost"
            size="sm"
            class="relative z-10 -my-1 {item.kind === 'attention'
              ? 'font-medium text-warning'
              : 'text-muted-foreground group-hover:text-foreground'}"
            onclick={() => onAction?.(item.action!.intent, item)}
            >{item.action.label}</Button
          >
        {/if}
        <div class="relative flex flex-none items-center gap-1 text-right">
          <span class="text-xs tabular-nums text-muted-foreground"
            >{notificationTime(item, now)}</span
          >
          {#if finished}
            <Button
              variant="ghost"
              size="icon-sm"
              class="relative z-10"
              ariaLabel="Dismiss"
              onclick={() => onDismiss?.(item.id)}
              ><X aria-hidden="true" /></Button
            >
          {/if}
        </div>
      </div>
      {#if item.context && item.kind !== "succeeded"}
        <p class="truncate text-xs text-muted-foreground">
          {item.context}
        </p>
      {/if}
      {#if item.detail}
        <p class="line-clamp-2 text-xs text-destructive">{item.detail}</p>
      {/if}
      {#if item.progress}
        <Progress
          class="mt-1"
          value={Math.min(
            100,
            (item.progress.completed / item.progress.total) * 100,
          )}
        />
      {/if}
      {#if item.children.length}
        <Collapsible.Root bind:open={expanded[item.id]}>
          <Collapsible.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="sm"
                class="group/disc relative z-10 -ml-1.5 mt-0.5 text-muted-foreground"
              >
                <ChevronRight
                  class="transition-transform group-aria-expanded/disc:rotate-90"
                  aria-hidden="true"
                />Show details
              </Button>
            {/snippet}
          </Collapsible.Trigger>
          <PopoverViews key={Boolean(expanded[item.id])}>
            {#if expanded[item.id]}
              <ul class="mt-1 grid gap-0.5 border-l pl-2">
                {#each item.children as child (child.id)}
                  <li class="flex items-center gap-1.5 text-xs">
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
                    <span class="text-muted-foreground"
                      >{childLabel[child.status]}</span
                    >
                  </li>
                {/each}
              </ul>
            {/if}
          </PopoverViews>
        </Collapsible.Root>
      {/if}
    </div>
  </div>
{/snippet}
