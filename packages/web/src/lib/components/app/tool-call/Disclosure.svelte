<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { Snippet } from "svelte";

  type Props = {
    label: string;
    open?: boolean;
    children: Snippet;
  };
  let { label, open = false, children }: Props = $props();
  let isOpen = $state(open);
</script>

<button
  type="button"
  class="tool-section-toggle"
  aria-expanded={isOpen}
  onclick={() => (isOpen = !isOpen)}
>
  <ChevronRight class="chevron" size={12} strokeWidth={2.4} />
  <span>{label}</span>
</button>
{#if isOpen}
  {@render children()}
{/if}

<style>
  .tool-section-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    width: fit-content;
    border: 0;
    background: transparent;
    color: var(--muted-foreground);
    padding: 0;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .tool-section-toggle:hover {
    color: var(--foreground);
  }

  .tool-section-toggle :global(.chevron) {
    transition: transform 120ms ease;
  }

  .tool-section-toggle[aria-expanded="true"] :global(.chevron) {
    transform: rotate(90deg);
  }
</style>
