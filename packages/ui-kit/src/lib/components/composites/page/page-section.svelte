<!--
@component
Titled group on a card surface; hold `FieldRow`/`ToggleRow`s, or a `PageList` with `surface={false}`.
-->

<!--
  A titled block of a page: heading line above a card surface. Rows
  (`FieldRow`, `ToggleRow`, `PageItem`, `PageEmptyState`) read the surface's
  `data-page-surface` / `data-page-divided` attributes to pad themselves and
  drop their own chrome, so place them directly in the body.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** DOM id of the section (anchor target); the heading gets `<id>-title`. */
  id?: string;
  /** Omit for a bare surface (e.g. a section whose page header already names it). */
  title?: string;
  /** One line of muted text under the heading. */
  description?: string;
  /** Inline after the title, e.g. an info hint. */
  titleHint?: Snippet;
  /** Buttons at the right of the heading line. */
  actions?: Snippet;
  /**
   * Small captions at the right of the heading line, or on a short line of
   * their own when the section has `actions`.
   */
  labels?: Snippet;
  /** Content on the line above the surface, under the heading. */
  beforeBody?: Snippet;
  /**
   * Rows are separated by hairlines and pad themselves. Without it the body
   * keeps a padded stack for free-form content.
   */
  divided?: boolean;
  /**
   * Body sits on a card surface. Turn it off when the body is already its own
   * card, e.g. a `PageList`.
   */
  surface?: boolean;
  class?: string;
  /** Classes for the body, e.g. its surface padding. */
  bodyClass?: string;
  /** Muted notes under the surface, outside its card. */
  footer?: Snippet;
  children: Snippet;
};

let {
  id,
  title,
  description,
  titleHint,
  actions,
  labels,
  beforeBody,
  divided = false,
  surface = true,
  class: className,
  bodyClass,
  footer,
  children,
}: Props = $props();
</script>

<!-- The negative inline margin plus matching padding is a net-zero inset so a
     highlight wash can breathe around the content. The heading sits outside,
     above the surface. -->
<section
  {id}
  aria-labelledby={id && title ? `${id}-title` : undefined}
  class={cn("-mx-2 grid min-w-0 scroll-mt-3 gap-2 px-2", className)}
>
  {#if title || description || actions || labels}
    <div class="flex min-h-6 min-w-0 items-end justify-between gap-3">
      <div class="grid min-w-0 gap-0.5">
        {#if title}
          <div class="flex min-w-0 items-center gap-1.5">
            <h3
              id={id ? `${id}-title` : undefined}
              tabindex="-1"
              class="truncate text-ui font-medium text-foreground outline-none"
            >
              {title}
            </h3>
            {#if titleHint}{@render titleHint()}{/if}
          </div>
        {/if}
        {#if description}
          <p class="text-caption text-muted-foreground">{description}</p>
        {/if}
      </div>
      {#if actions}
        <div class="flex flex-none items-center gap-1.5">
          {@render actions()}
        </div>
      {:else if labels}
        <div class="flex-none pr-[calc(--spacing(3)+1px)]">
          {@render labels()}
        </div>
      {/if}
    </div>
    {#if actions && labels}
      <div class="flex justify-end pr-[calc(--spacing(3)+1px)]">
        {@render labels()}
      </div>
    {/if}
  {/if}
  {#if beforeBody}{@render beforeBody()}{/if}

  <!-- `data-page-surface` is the contract nested cards (PageList, card empty
       states) read to drop their own chrome. -->
  <div
    data-page-surface={surface ? "" : undefined}
    data-page-divided={surface && divided ? "" : undefined}
    class={cn(
      "group/surface grid min-w-0",
      surface
        ? divided
          ? "divide-y divide-border rounded-lg border bg-card"
          : "gap-1 rounded-lg border bg-card px-3 py-1.5"
        : "gap-2",
      bodyClass,
    )}
  >
    {@render children()}
  </div>
  {#if footer}
    <div class="min-w-0 px-0.5 text-caption text-muted-foreground">
      {@render footer()}
    </div>
  {/if}
</section>
