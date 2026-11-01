<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { settingsSectionDomId } from "./section-id";
import SettingsInfoHint from "./SettingsInfoHint.svelte";

type Props = {
  /** Section id from the page registry; omit for a section with no nav anchor. */
  id?: string;
  /** Omit for a bare surface (e.g. a section whose page header already names it). */
  title?: string;
  /** One line of muted text under the heading. */
  description?: string;
  /** Longer detail shown in a tooltip beside the title. */
  info?: string;
  /**
   * Rows are separated by hairlines and pad themselves (`SettingsRow` reads
   * `data-settings-divided`). Without it the body keeps the legacy padded
   * stack for pages that mix rows with free-form content.
   */
  divided?: boolean;
  /**
   * Rows sit on a card surface so the surface, not a rule, separates
   * sections. Turn it off when the body is already its own card, e.g. a
   * `SettingsList`.
   */
  surface?: boolean;
  class?: string;
  /** Classes for the body, e.g. its surface padding. */
  bodyClass?: string;
  actions?: Snippet;
  children: Snippet;
};

let {
  id,
  title,
  description,
  info,
  divided = false,
  surface = true,
  class: className,
  bodyClass,
  actions,
  children,
}: Props = $props();
</script>

<!-- The negative inline margin plus matching padding is a net-zero inset so the
     one-shot section flash wash breathes around the content. The heading sits
     outside, above the surface. -->
<section
  id={id ? settingsSectionDomId(id) : undefined}
  aria-labelledby={id && title
    ? `${settingsSectionDomId(id)}-title`
    : undefined}
  class={cn("-mx-2 grid min-w-0 scroll-mt-3 gap-2 px-2", className)}
>
  {#if title || description || actions}
    <div class="flex min-h-6 min-w-0 items-end justify-between gap-3">
      <div class="grid min-w-0 gap-0.5">
        {#if title}
          <div class="flex min-w-0 items-center gap-1.5">
            <h3
              id={id ? `${settingsSectionDomId(id)}-title` : undefined}
              tabindex="-1"
              class="truncate text-ui font-medium text-foreground outline-none"
            >
              {title}
            </h3>
            {#if info}
              <SettingsInfoHint text={info} label={`About ${title}`} />
            {/if}
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
      {/if}
    </div>
  {/if}

  <!-- `data-settings-surface` is the contract nested cards (SettingsList,
       card empty states, catalogs) read to drop their own chrome. -->
  <div
    data-settings-surface={surface ? "" : undefined}
    data-settings-divided={surface && divided ? "" : undefined}
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
</section>
