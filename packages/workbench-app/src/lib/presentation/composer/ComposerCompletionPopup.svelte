<script lang="ts">
// The single surface for @-mention and slash suggestions. Best match sits
// nearest the text: opened above the composer, groups and rows run bottom-up
// and the status bar is the top edge; opened below, everything is top-down.
// Anchored at the edge facing the editor so late results never move the
// selected row.
import Check from "@lucide/svelte/icons/check";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CloudOff from "@lucide/svelte/icons/cloud-off";
import Info from "@lucide/svelte/icons/info";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import AtSign from "@lucide/svelte/icons/at-sign";
import X from "@lucide/svelte/icons/x";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { PopupModel } from "./composer-completion-model";
import { popupRowIcon, popupRowIconClass } from "./composer-completion-icons";

let {
  model,
  anchor,
  onpick,
  onhover,
  ontoggle,
  onscope,
  onclearscope,
  onfooteraction,
}: {
  model: PopupModel;
  /** Element whose edge the popup attaches to (the editor). */
  anchor: HTMLElement | undefined;
  onpick: (id: string) => void;
  onhover: (id: string) => void;
  ontoggle: (id: string) => void;
  onscope: (scope: NonNullable<PopupModel["groups"][number]["scope"]>) => void;
  onclearscope: () => void;
  onfooteraction: () => void;
} = $props();

const above = $derived(model.placement === "above");
const ordered = $derived(
  above
    ? [...model.groups]
        .reverse()
        .map((group) => ({ ...group, rows: [...group.rows].reverse() }))
    : model.groups,
);

let place = $state({ left: 0, edge: 0, width: 448 });
// Attach to the whole composer (quick-action chips sit between the editor and
// the card edge, and must stay uncovered), falling back to the editor itself.
function measure() {
  if (!anchor) return;
  const frame =
    anchor.closest<HTMLElement>(
      "[data-composer-popup-anchor], [data-tour-id='composer']",
    ) ?? anchor;
  const rect = frame.getBoundingClientRect();
  // Horizontal position follows the content box (the card edge), not the
  // padded border box; vertical anchoring stays on the whole frame.
  const style = getComputedStyle(frame);
  const inlineStart = rect.left + (parseFloat(style.paddingLeft) || 0);
  const inlineEnd = rect.right - (parseFloat(style.paddingRight) || 0);
  const width = Math.max(
    0,
    Math.min(448, inlineEnd - inlineStart, window.innerWidth - 16),
  );
  place = {
    left: Math.max(8, Math.min(inlineStart, window.innerWidth - width - 8)),
    edge: above ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
    width,
  };
}
$effect(() => {
  void model.placement;
  measure();
  window.addEventListener("resize", measure);
  window.addEventListener("scroll", measure, true);
  return () => {
    window.removeEventListener("resize", measure);
    window.removeEventListener("scroll", measure, true);
  };
});

let list: HTMLDivElement | undefined = $state();
$effect(() => {
  void model.selectedId;
  list
    ?.querySelector<HTMLElement>('[aria-selected="true"]')
    ?.scrollIntoView({ block: "nearest" });
});
// Opened above, the list is bottom-aligned: start scrolled to the best match.
$effect(() => {
  if (above && list) list.scrollTop = list.scrollHeight;
});

const footerIcons = {
  info: Info,
  warning: TriangleAlert,
  offline: CloudOff,
  error: CircleAlert,
};
const toneClass = {
  muted: "text-muted-foreground",
  info: "text-info",
  warning: "text-warning",
  destructive: "text-destructive",
};
const selectedRowId = $derived(model.selectedId);
const listboxId = "composer-suggestions";
</script>

{#snippet statusBar()}
  <div
    class="flex h-7 shrink-0 items-center gap-2 bg-panel px-2 text-ui text-muted-foreground {above
      ? 'border-b'
      : 'border-t'} border-border"
  >
    {#if model.scope}
      <span
        class="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-muted pr-0.5 pl-1.5 text-foreground"
      >
        <AtSign class="size-3 text-muted-foreground" />{model.scope.label}
        <button
          type="button"
          tabindex="-1"
          class="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          aria-label="Search all categories"
          onmousedown={(event) => {
            event.preventDefault();
            onclearscope();
          }}><X class="size-3" /></button
        >
      </span>
    {/if}
    {#if model.footer}
      {@const footer = model.footer}
      {@const FooterIcon =
        footer.icon && footer.icon !== "spinner"
          ? footerIcons[footer.icon]
          : undefined}
      <span class="flex min-w-0 items-center gap-1.5 {toneClass[footer.tone]}">
        {#if footer.icon === "spinner"}<Spinner
            class="size-3 shrink-0"
          />{:else if FooterIcon}<FooterIcon class="size-3.5 shrink-0" />{/if}
        <span class="truncate">{footer.text}</span>
        {#if footer.action}
          <button
            type="button"
            tabindex="-1"
            class="shrink-0 text-foreground hover:text-primary"
            onmousedown={(event) => {
              event.preventDefault();
              onfooteraction();
            }}>{footer.action.label}</button
          >
        {/if}
      </span>
    {:else if model.showScopeHint}
      <span class="min-w-0 truncate"
        >Narrow: <span class="font-mono text-foreground">pr: skill: file:</span>
        …</span
      >
    {:else if model.scope && !model.query}
      <span class="truncate"><Kbd>⌫</Kbd> all categories</span>
    {/if}
    <span class="ml-auto flex shrink-0 items-center gap-2">
      <span class="inline-flex items-center gap-1"
        ><Kbd>↵</Kbd>{model.primary}</span
      >
      {#if !model.footer}<span class="inline-flex items-center gap-1"
          ><Kbd>esc</Kbd></span
        >{/if}
    </span>
  </div>
{/snippet}

<div
  class="pointer-events-auto fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-overlay"
  style:left="{place.left}px"
  style:width="{place.width}px"
  style:bottom={above ? `${place.edge}px` : undefined}
  style:top={above ? undefined : `${place.edge}px`}
  data-composer-suggestions
>
  {#if above}{@render statusBar()}{/if}

  <div
    bind:this={list}
    id={listboxId}
    role="listbox"
    aria-label="Suggestions"
    class="flex max-h-[18rem] scroll-pt-7 scroll-pb-1 flex-col overflow-y-auto px-1 pb-1"
  >
    <!-- Bottom-align short lists with a spacer: `justify-end` would make
         overflowing content unreachable above the scroll origin. -->
    {#if above}<div class="flex-1" aria-hidden="true"></div>{/if}
    {#if model.empty}
      <div class="flex flex-col gap-0.5 px-2 py-3 text-ui">
        <span class="text-foreground">{model.empty}</span>
        {#if model.mode === "mention"}<span class="text-muted-foreground"
            >Keep typing — a space ends the mention.</span
          >{/if}
      </div>
    {/if}
    {#each ordered as group (group.id)}
      <!-- Per-group wrapper bounds the sticky header to its own rows. -->
      <div class="flex flex-col">
        <div
          class="sticky top-0 z-10 flex h-6 shrink-0 items-center justify-between bg-popover px-2 text-ui text-muted-foreground"
        >
          <span>{group.label}</span>
          {#if group.loading}
            <span class="inline-flex items-center gap-1"
              ><Spinner class="size-3" /> Updating</span
            >
          {:else if group.more && group.scope && !model.scope}
            <button
              type="button"
              tabindex="-1"
              class="rounded-sm px-1 hover:text-foreground"
              onmousedown={(event) => {
                event.preventDefault();
                onscope(group.scope!);
              }}>+{group.more} more</button
            >
          {/if}
        </div>
        {#each group.rows as row (row.id)}
          {@const Icon = popupRowIcon(row)}
          {@const isSelected = row.id === selectedRowId}
          <div
            role="option"
            tabindex="-1"
            aria-selected={isSelected}
            aria-disabled={row.state === "unavailable"}
            title={row.title}
            class="flex h-7 w-full min-w-0 shrink-0 cursor-default items-center gap-2 rounded-md px-2 text-left text-ui {isSelected
              ? 'bg-muted text-foreground'
              : 'hover:bg-hover'} {row.state === 'unavailable'
              ? 'opacity-60'
              : ''}"
            onmousemove={() => onhover(row.id)}
            onmousedown={(event) => {
              event.preventDefault();
              onpick(row.id);
            }}
          >
            <Icon class="size-3.5 shrink-0 {popupRowIconClass(row)}" />
            {#if row.mono}
              <span class="shrink-0 font-mono">{row.name}</span>
              {#if row.dir}
                <span
                  class="min-w-0 truncate text-left font-mono text-muted-foreground [direction:rtl]"
                  ><bdi dir="ltr">{row.dir}</bdi></span
                >
              {/if}
            {:else}
              <span class="max-w-[60%] shrink-0 truncate">{row.name}</span>
              {#if row.meta}<span class="min-w-0 truncate text-muted-foreground"
                  >{row.meta}</span
                >{/if}
            {/if}
            <span class="ml-auto flex shrink-0 items-center gap-1 pl-2">
              {#if model.pendingId === row.id}
                <Spinner class="size-3.5" />
              {:else if row.current}
                <Check class="size-3.5 text-muted-foreground" /><span
                  class="text-muted-foreground">Current</span
                >
              {:else if row.badge}
                <Badge variant={row.badge.variant}>{row.badge.text}</Badge>
              {/if}
              {#if isSelected && model.toggleLabel && model.pendingId !== row.id}
                <button
                  type="button"
                  tabindex="-1"
                  class="inline-flex h-5 items-center rounded-sm px-1 text-muted-foreground hover:bg-hover hover:text-foreground"
                  onmousedown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    ontoggle(row.id);
                  }}>{model.toggleLabel}<Kbd class="ml-1">⌥↵</Kbd></button
                >
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  {#if !above}{@render statusBar()}{/if}
</div>
