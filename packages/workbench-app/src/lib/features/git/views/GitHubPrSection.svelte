<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";
import type { Snippet } from "svelte";

type Props = {
  title?: string;
  contentClass?: string;
  class?: string;
  header?: Snippet;
  actions?: Snippet;
  children: Snippet;
};

let {
  title,
  contentClass,
  class: className,
  header,
  actions,
  children,
}: Props = $props();

const hasHeader = $derived(Boolean(title) || Boolean(header));
</script>

<section
  class={cn(
    "min-w-0 rounded-md border border-border bg-card text-xs",
    className,
  )}
>
  {#if hasHeader}
    <div class="flex min-h-7 items-center gap-2 px-3 pt-2">
      {#if header}
        {@render header()}
      {:else}
        <span class="min-w-0 flex-1 truncate font-semibold text-foreground"
          >{title}</span
        >
      {/if}
      {#if actions}
        <div class="ml-auto flex shrink-0 items-center gap-1">
          {@render actions()}
        </div>
      {/if}
    </div>
  {/if}
  <!-- Sections separate by surface and spacing; a rule under every header
       turned the pane into a stack of lines. -->
  <div class={cn(contentClass ?? "px-3 py-2.5", hasHeader && "pt-1.5")}>
    {@render children()}
  </div>
</section>
