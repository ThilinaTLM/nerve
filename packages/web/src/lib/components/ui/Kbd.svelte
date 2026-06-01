<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    class?: string;
  };

  let { children, class: className = "" }: Props = $props();
</script>

<kbd class={cn("ui-kbd", className)}>{@render children?.()}</kbd>

<style>
  .ui-kbd {
    display: inline-grid;
    min-width: 1.25rem;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0 0.24rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1.28;
    box-shadow: var(--shadow-panel);
  }
</style>
