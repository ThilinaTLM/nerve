<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    class?: string;
    tone?: "default" | "muted" | "elevated";
    variant?: "panel" | "flat" | "elevated";
  };

  let { children, class: className = "", tone = "default", variant = tone === "elevated" ? "elevated" : tone === "muted" ? "flat" : "panel" }: Props = $props();
</script>

<section class={cn("ui-card", variant, className)}>
  {@render children?.()}
</section>

<style>
  .ui-card {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
  }

  .flat {
    background: var(--color-panel-muted);
    box-shadow: none;
  }

  .elevated {
    background: var(--color-panel-raised);
    box-shadow: var(--shadow-elevated);
  }
</style>
