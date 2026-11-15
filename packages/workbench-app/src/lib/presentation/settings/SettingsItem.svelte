<!--
  One item in a settings catalog or entity list (tools, skills, extensions,
  providers, accounts). Fixed anatomy, all on one row:
    icon · title + exceptional badges / one status line · meta, actions, switch, chevron
  - A selectable row (the chosen account among several) passes `select` in
    place of the icon: an interactive control, e.g. a radio, in the icon's slot.
    Everything else stays: the row still opens its item.
  - `iconLabel` names the icon's kind in a tooltip (Tool · name).
  - The whole row opens the item when `onOpen` is set (hover fill, chevron).
    There is no separate Configure button. A row whose detail is small and
    read-mostly may expand in place instead: `onOpen` toggles, `expanded` turns
    the chevron, and the detail goes in `children`.
  - The status line is the summary, or the problem with its fix. A problem
    replaces the summary, so every row keeps the same height.
  - Off is shown by the switch and a muted title and icon, never in the text.
  Place items in a `SettingsList`.
-->
<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Lock from "@lucide/svelte/icons/lock";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { cn } from "@nervekit/ui-kit/utils";
import type { Component, Snippet } from "svelte";

type Icon = Component<{ class?: string; "aria-hidden"?: "true" }>;

type Props = {
  title: string;
  /** Identity glyph in a tile. Use `leading` instead for a custom mark (provider logo). */
  icon?: Icon;
  leading?: Snippet;
  /** Names the icon's kind in a tooltip; hovering the tile still opens the item. */
  iconLabel?: string;
  /** Interactive control (e.g. a radio) in the icon's slot; takes precedence over `icon`. */
  select?: Snippet;
  /** Turns title and icon muted without a switch (the owner is off). */
  muted?: boolean;
  /** How the item is set up, or what it does when it has no settings. One line. */
  summary?: string;
  /** The summary is a path or command. */
  mono?: boolean;
  /** Replaces the summary in warning tone; `action` is its fix. */
  problem?: string;
  problemAction?: { label: string; onclick: () => void };
  /** Omit for items without a switch. */
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  switchLabel?: string;
  /** Shows "Always on" in place of the switch. */
  always?: boolean;
  /** Disables the switch; `lockedBy` also explains why. */
  disabled?: boolean;
  lockedBy?: string;
  /** Opens the item's detail view or dialog from anywhere on the row. */
  onOpen?: () => void;
  openLabel?: string;
  /** For a row that expands in place instead of opening a detail view: whether `children` is shown. The chevron turns down. */
  expanded?: boolean;
  /** Exceptional states only (Experimental, Shadowed, Default, version). */
  badges?: Snippet;
  /** Quiet trailing content before the switch: change indicator, counts. */
  meta?: Snippet;
  /** Icon actions other than opening (Test, Copy, Delete). */
  actions?: Snippet;
  /** Content under the status line, for the rare row that needs more (nested choices). */
  children?: Snippet;
  tourId?: string;
  class?: string;
};

let {
  title,
  icon: Icon,
  leading,
  iconLabel,
  select,
  muted = false,
  summary,
  mono = false,
  problem,
  problemAction,
  checked = $bindable(),
  onCheckedChange,
  switchLabel,
  always = false,
  disabled = false,
  lockedBy,
  onOpen,
  openLabel,
  expanded,
  badges,
  meta,
  actions,
  children,
  tourId,
  class: className,
}: Props = $props();

const off = $derived(muted || checked === false);
const hasSwitch = $derived(checked !== undefined && !always);
</script>

<div
  role="listitem"
  data-tour-id={tourId}
  class={cn(
    "group/item relative flex min-h-14 items-center gap-3 px-3 py-2 transition-colors",
    onOpen && "hover:bg-hover",
    className,
  )}
>
  {#if onOpen}
    <!-- Full-row target under the content; interactive children sit above it. -->
    <button
      type="button"
      class="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      aria-label={openLabel ?? `Open ${title}`}
      aria-expanded={expanded}
      onclick={onOpen}
    ></button>
  {/if}

  {#if select}
    <span
      class="pointer-events-none flex size-8 flex-none items-center justify-center"
    >
      <span class="pointer-events-auto relative flex">{@render select()}</span>
    </span>
  {:else if leading}
    <span
      class="pointer-events-none flex size-8 flex-none items-center justify-center"
    >
      {@render leading()}
    </span>
  {:else if Icon}
    {@const tile = cn(
      "flex size-8 flex-none items-center justify-center rounded-md border bg-card",
      off ? "text-muted-foreground" : "text-foreground",
    )}
    {#if iconLabel}
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <!-- Above the full-row target, so a click forwards to it. -->
              <span
                {...props}
                class={cn(tile, "relative")}
                role="presentation"
                onclick={onOpen}
              >
                <Icon class="size-4" aria-hidden="true" />
              </span>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{iconLabel}</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    {:else}
      <span class={cn(tile, "pointer-events-none")}>
        <Icon class="size-4" aria-hidden="true" />
      </span>
    {/if}
  {/if}

  <div class="pointer-events-none grid min-w-0 flex-1 gap-0.5">
    <div class="flex min-w-0 items-center gap-1.5">
      <span
        class={cn(
          "truncate text-ui",
          off ? "text-muted-foreground" : "text-foreground",
        )}>{title}</span
      >
      {#if badges}
        <span
          class="pointer-events-auto relative flex flex-none items-center gap-1"
        >
          {@render badges()}
        </span>
      {/if}
    </div>
    {#if problem && !off}
      <span class="flex min-w-0 items-center gap-1 text-caption text-warning">
        <TriangleAlert class="size-3 flex-none" aria-hidden="true" />
        <span class="truncate" title={problem}>{problem}</span>
        {#if problemAction}
          <span class="flex-none text-muted-foreground" aria-hidden="true"
            >·</span
          >
          <button
            type="button"
            class="pointer-events-auto relative flex-none rounded-sm font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
            onclick={problemAction.onclick}>{problemAction.label}</button
          >
        {/if}
      </span>
    {:else if summary}
      <span
        class={cn(
          "truncate text-caption text-muted-foreground",
          mono && "font-mono",
        )}
        title={summary}>{summary}</span
      >
    {/if}
    {#if children}
      <div class="pointer-events-auto relative min-w-0">
        {@render children()}
      </div>
    {/if}
  </div>

  <div class="relative flex flex-none items-center gap-2">
    {#if meta}{@render meta()}{/if}
    {#if actions}{@render actions()}{/if}
    {#if lockedBy}
      <span class="inline-flex" title={`Locked by ${lockedBy}`}>
        <Lock
          class="size-3.5 text-muted-foreground"
          aria-label={`Locked by ${lockedBy}`}
        />
      </span>
    {/if}
    {#if always}
      <span class="text-caption text-muted-foreground">Always on</span>
    {:else if hasSwitch}
      <Switch
        bind:checked
        disabled={disabled || !!lockedBy}
        aria-label={switchLabel ?? `Enable ${title}`}
        {onCheckedChange}
      />
    {/if}
    {#if onOpen || !actions}
      <!-- Reserved even without onOpen so switches align down the list. -->
      <ChevronRight
        class={cn(
          "size-4 text-muted-foreground transition-transform",
          expanded ? "rotate-90" : "group-hover/item:translate-x-0.5",
          !onOpen && "invisible",
        )}
        aria-hidden="true"
      />
    {/if}
  </div>
</div>
