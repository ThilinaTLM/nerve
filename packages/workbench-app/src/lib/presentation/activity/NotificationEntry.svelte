<!--
  The one notification entry used across the Notifications popover: list items
  and persistent system notices share icon, type, actions and disclosure.

  Anatomy: status icon · title · unread dot · time · dismiss
           context (muted) / detail (error) / progress
           actions (ghost buttons), optional "Show …" disclosure
           disclosed body (grouped content such as steps or conversations)
-->
<script lang="ts" module>
export type NotificationTone =
  | "attention"
  | "failed"
  | "warning"
  | "running"
  | "succeeded"
  | "cancelled"
  | "info";
export type NotificationEntryAction = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import Ban from "@lucide/svelte/icons/ban";
import BellRing from "@lucide/svelte/icons/bell-ring";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Info from "@lucide/svelte/icons/info";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

let {
  tone,
  title,
  titleHint,
  context,
  detail,
  time,
  unread = false,
  progress,
  actions = [],
  onDismiss,
  disclosure,
  expanded = $bindable(false),
  interactive = false,
  children,
}: {
  tone: NotificationTone;
  title: string;
  /** Tooltip for the title, e.g. the full path of a configuration file. */
  titleHint?: string;
  /** One muted line: where it happened. */
  context?: string;
  /** Why it needs attention, e.g. an error message; red only for failures. */
  detail?: string;
  time?: string;
  unread?: boolean;
  /** 0–100 while work is running. */
  progress?: number;
  actions?: NotificationEntryAction[];
  onDismiss?: () => void;
  /** Label of the toggle that reveals `children`, e.g. "3 steps". Without it `children` always show. */
  disclosure?: string;
  expanded?: boolean;
  /** The whole entry is a target (the host handles the click); adds hover feedback. */
  interactive?: boolean;
  children?: Snippet;
} = $props();

const icons = {
  attention: BellRing,
  failed: CircleAlert,
  warning: TriangleAlert,
  succeeded: CircleCheck,
  cancelled: Ban,
  info: Info,
} as const;
const tones = {
  attention: "text-warning",
  failed: "text-destructive",
  warning: "text-warning",
  running: "text-muted-foreground",
  succeeded: "text-success",
  cancelled: "text-muted-foreground",
  info: "text-info",
} as const;
const Icon = $derived(tone === "running" ? undefined : icons[tone]);
</script>

<div
  class={[
    "grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 rounded-md py-2 pl-1.5 pr-1 text-left",
    interactive && "cursor-pointer hover:bg-hover",
  ]}
>
  <span class="mt-0.5 flex-none {tones[tone]}">
    {#if Icon}<Icon class="size-4" aria-hidden="true" />{:else}<Spinner
        class="size-4"
      />{/if}
  </span>
  <div class="grid min-w-0 gap-0.5">
    <div class="flex min-h-5 items-center gap-2">
      <p
        class="min-w-0 flex-1 truncate text-ui {tone === 'cancelled'
          ? 'text-muted-foreground'
          : ''}"
        title={titleHint ?? title}
      >
        {title}
      </p>
      {#if unread}<span
          class="size-1.5 flex-none rounded-full bg-info"
          role="img"
          aria-label="Unread"
        ></span>{/if}
      {#if time}<span
          class="flex-none text-ui tabular-nums text-muted-foreground"
          >{time}</span
        >{/if}
      {#if onDismiss}<Button
          variant="ghost"
          size="icon-sm"
          class="-my-1 -mr-0.5 text-muted-foreground"
          ariaLabel={`Dismiss ${title}`}
          onclick={onDismiss}><X aria-hidden="true" /></Button
        >{/if}
    </div>
    {#if context}
      <p class="truncate text-ui text-muted-foreground" title={context}>
        {context}
      </p>
    {/if}
    {#if detail}
      <p
        class="line-clamp-2 text-ui break-words {tone === 'failed'
          ? 'text-destructive'
          : 'text-muted-foreground'}"
        title={detail}
      >
        {detail}
      </p>
    {/if}
    {#if progress !== undefined}<Progress class="mt-1" value={progress} />{/if}
    {#if actions.length || disclosure}
      <div class="-ml-1.5 flex flex-wrap items-center">
        {#if disclosure}
          <Button
            variant="ghost"
            size="sm"
            class="group/disc text-muted-foreground"
            aria-expanded={expanded}
            onclick={() => (expanded = !expanded)}
            ><ChevronRight
              class="transition-transform group-aria-expanded/disc:rotate-90"
              aria-hidden="true"
            />{expanded ? "Hide" : "Show"}
            {disclosure}</Button
          >
        {/if}
        {#each actions as action (action.label)}
          <Button
            variant="ghost"
            size="sm"
            class={action.destructive
              ? "text-destructive"
              : "text-muted-foreground hover:text-foreground"}
            disabled={action.disabled}
            onclick={action.onSelect}>{action.label}</Button
          >
        {/each}
      </div>
    {/if}
    {#if children && (!disclosure || expanded)}{@render children()}{/if}
  </div>
</div>
