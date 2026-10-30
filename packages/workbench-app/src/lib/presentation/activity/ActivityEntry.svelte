<!--
  One activity row: icon column, title line (inline action, time, trailing),
  muted description, optional body and footer actions. Every entry in the
  Notifications popover renders through this, so spacing, type and hover match.
-->
<script lang="ts">
import type { Snippet } from "svelte";

let {
  title,
  titleHint,
  description,
  detail,
  time,
  unread = false,
  muted = false,
  openLabel,
  onOpen,
  icon,
  actions,
  trailing,
  footer,
  children,
}: {
  title: string;
  /** Tooltip for the title, e.g. the full path of a configuration file. */
  titleHint?: string;
  /** One muted line under the title. */
  description?: string;
  /** Error text under the description. */
  detail?: string;
  time?: string;
  unread?: boolean;
  muted?: boolean;
  /** Makes the whole row open something; needs a label. */
  openLabel?: string;
  onOpen?: () => void;
  icon: Snippet;
  /** A single quick action on the title line. */
  actions?: Snippet;
  /** After the time, e.g. dismiss. */
  trailing?: Snippet;
  /** Ghost `sm` buttons under the text. */
  footer?: Snippet;
  children?: Snippet;
} = $props();
</script>

<div
  class="group relative grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 rounded-md py-2 pl-0.5 pr-1 {onOpen
    ? 'hover:bg-muted/60'
    : ''} {muted ? 'text-muted-foreground' : ''}"
>
  {#if onOpen}
    <button
      type="button"
      class="absolute inset-0 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={openLabel}
      onclick={onOpen}
    ></button>
  {/if}
  <span class="relative mt-0.5 flex-none">
    {@render icon()}
    {#if unread}
      <span
        class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-info ring-2 ring-popover"
        role="img"
        aria-label="Unread"
      ></span>
    {/if}
  </span>
  <div class="min-w-0">
    <div class="flex items-center gap-1">
      <p class="min-w-0 flex-1 truncate text-sm" title={titleHint}>{title}</p>
      {@render actions?.()}
      {#if time || trailing}
        <div class="relative flex flex-none items-center gap-1 text-right">
          {#if time}
            <span class="text-xs tabular-nums text-muted-foreground"
              >{time}</span
            >
          {/if}
          {@render trailing?.()}
        </div>
      {/if}
    </div>
    {#if description}
      <p
        class="line-clamp-2 text-xs break-words text-muted-foreground"
        title={description}
      >
        {description}
      </p>
    {/if}
    {#if detail}
      <p class="line-clamp-2 text-xs text-destructive">{detail}</p>
    {/if}
    {@render children?.()}
    {#if footer}
      <div class="relative z-10 -ml-1.5 mt-0.5 flex flex-wrap items-center">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>
