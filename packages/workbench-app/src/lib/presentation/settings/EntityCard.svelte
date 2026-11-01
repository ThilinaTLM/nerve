<!--
  One card per entity (an agent profile): header with title, badges and
  actions, muted description, divided `EntityRow`s, and an optional footer.
  Entity titles are sm medium foreground, one step below section headings.
-->
<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  title?: string;
  description?: string;
  /** Replaces the plain title and description (e.g. an edit form). */
  head?: Snippet;
  badges?: Snippet;
  actions?: Snippet;
  /** `EntityRow`s. */
  children?: Snippet;
  footer?: Snippet;
};

let { title, description, head, badges, actions, children, footer }: Props =
  $props();
</script>

<article class="grid min-w-0 overflow-hidden rounded-lg border bg-card">
  <header class="flex items-start justify-between gap-3 px-3 pt-2.5 pb-2">
    <div class="grid min-w-0 flex-1 gap-1">
      {#if head}
        {@render head()}
      {:else}
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <h4 class="text-ui text-foreground">{title}</h4>
          {#if badges}{@render badges()}{/if}
        </div>
        {#if description}
          <p class="text-caption text-muted-foreground">{description}</p>
        {/if}
      {/if}
    </div>
    {#if actions}
      <div class="flex flex-none items-center gap-1">{@render actions()}</div>
    {/if}
  </header>
  {#if children}
    <div class="grid divide-y divide-border border-t">{@render children()}</div>
  {/if}
  {#if footer}
    <footer class="border-t px-1.5 py-1.5">{@render footer()}</footer>
  {/if}
</article>
