<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    children?: Snippet;
    class?: string;
    tone?: "default" | "muted" | "elevated";
  };

  let { children, class: className = "", tone = "default" }: Props = $props();
</script>

<section class={`ui-card ${tone} ${className}`}>
  {@render children?.()}
</section>

<style>
  .ui-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
  }

  .muted {
    background: var(--color-panel-muted);
    box-shadow: none;
  }

  .elevated {
    background: var(--color-panel-raised);
    box-shadow: var(--shadow-elevated);
  }
</style>
