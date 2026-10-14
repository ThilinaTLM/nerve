<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { settingsSectionDomId } from "./section-id";
import SettingsInfoHint from "./SettingsInfoHint.svelte";

type Props = {
  /** Section id from the page registry. */
  id: string;
  title: string;
  /** Detail shown in a tooltip beside the title, never as a paragraph. */
  info?: string;
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
  info,
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
  id={settingsSectionDomId(id)}
  aria-labelledby={`${settingsSectionDomId(id)}-title`}
  class={cn("-mx-2 grid min-w-0 scroll-mt-3 gap-2 px-2", className)}
>
  <div class="flex min-h-6 min-w-0 items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-1.5">
      <h3
        id={`${settingsSectionDomId(id)}-title`}
        tabindex="-1"
        class="truncate text-sm font-semibold text-foreground outline-none"
      >
        {title}
      </h3>
      {#if info}
        <SettingsInfoHint text={info} label={`About ${title}`} />
      {/if}
    </div>
    {#if actions}
      <div class="flex flex-none items-center gap-1.5">
        {@render actions()}
      </div>
    {/if}
  </div>

  <!-- `data-settings-surface` is the contract nested cards (SettingsList,
       card empty states, catalogs) read to drop their own chrome. -->
  <div
    data-settings-surface={surface ? "" : undefined}
    class={cn(
      "group/surface grid min-w-0",
      surface ? "gap-1 rounded-lg border bg-card px-3 py-1.5" : "gap-2",
      bodyClass,
    )}
  >
    {@render children()}
  </div>
</section>
