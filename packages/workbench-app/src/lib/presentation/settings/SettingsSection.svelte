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
  class?: string;
  actions?: Snippet;
  children: Snippet;
};

let { id, title, info, class: className, actions, children }: Props = $props();
</script>

<!-- The negative inline margin plus matching padding is a net-zero inset so the
     one-shot section flash wash breathes around the content. -->
<section
  id={settingsSectionDomId(id)}
  aria-labelledby={`${settingsSectionDomId(id)}-title`}
  class={cn("-mx-2 grid min-w-0 scroll-mt-3 gap-2 px-2", className)}
>
  <div class="flex min-w-0 items-center justify-between gap-3">
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

  <div class="grid min-w-0 gap-2">
    {@render children()}
  </div>
</section>
