<!--
  A page header. In detail mode (`parent`) the title row becomes a
  breadcrumb, "Extensions › [mark] Name": the parent is the back button,
  the item's description replaces the page's and its actions take the actions
  slot. The box is the same in both modes, so nothing moves vertically when a
  detail opens or closes. The heading takes focus when a detail opens, so
  Escape and keyboard users stay inside the page.
-->
<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** Page title (the heading). */
  title: string;
  /** One muted line under the title. */
  description?: string;
  class?: string;
  /** Detail mode: the page this item belongs to; `onBack` returns to its list. */
  parent?: { label: string; onBack: () => void };
  /** The item's mark, before its title (detail mode). */
  leading?: Snippet;
  /** Buttons at the right of the title row. */
  actions?: Snippet;
  /** Rendered under the title row (e.g. a tab bar). */
  below?: Snippet;
};

let {
  title,
  description,
  class: className,
  parent,
  leading,
  actions,
  below,
}: Props = $props();

let heading = $state<HTMLElement>();
const detail = $derived(!!parent);
$effect(() => {
  if (detail) heading?.focus({ preventScroll: true });
});
</script>

<header class={cn("grid min-w-0 gap-1 pb-2", className)}>
  <div class="flex min-w-0 items-start justify-between gap-4">
    <div class="grid min-w-0 gap-0.5">
      <h2
        bind:this={heading}
        tabindex="-1"
        class="flex min-w-0 items-center gap-1.5 text-title font-medium text-foreground outline-none"
      >
        {#if parent}
          <button
            type="button"
            class="flex-none rounded-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
            title={`Back to ${parent.label}`}
            onclick={parent.onBack}>{parent.label}</button
          >
          <ChevronRight
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
          {#if leading}{@render leading()}{/if}
          <span class="min-w-0 truncate" aria-current="page">{title}</span>
        {:else}
          {title}
        {/if}
      </h2>
      {#if description}
        <p class="text-ui text-muted-foreground">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex flex-none flex-wrap items-center justify-end gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>
  {#if below}
    {@render below()}
  {/if}
</header>
