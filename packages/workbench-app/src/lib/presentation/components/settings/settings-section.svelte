<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import { settingsSectionDomId } from "./section-id";

type Props = {
  /** Section id from the page registry. */
  id: string;
  title: string;
  description?: string;
  class?: string;
  actions?: Snippet;
  children: Snippet;
};

let {
  id,
  title,
  description,
  class: className,
  actions,
  children,
}: Props = $props();
</script>

<section
  id={settingsSectionDomId(id)}
  aria-labelledby={`${settingsSectionDomId(id)}-title`}
  class={cn("settings-section grid min-w-0 gap-2", className)}
>
  <div class="flex min-w-0 items-center justify-between gap-3">
    <div class="grid min-w-0 gap-0.5">
      <h3
        id={`${settingsSectionDomId(id)}-title`}
        tabindex="-1"
        class="text-xs font-semibold tracking-wide text-muted-foreground uppercase outline-none"
      >
        {title}
      </h3>
      {#if description}
        <p class="text-xs text-muted-foreground">{description}</p>
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
