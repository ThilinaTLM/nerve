<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    children?: Snippet;
    class?: string;
    tone?: "neutral" | "accent" | "good" | "warn" | "danger";
  };

  let { children, class: className = "", tone = "neutral" }: Props = $props();
</script>

<span class={`ui-badge ${tone} ${className}`}>
  {@render children?.()}
</span>

<style>
  .ui-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    width: fit-content;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    font-size: 0.68rem;
    font-weight: 650;
    letter-spacing: 0;
  }

  .neutral {
    background: var(--color-panel-muted);
    color: var(--color-muted);
  }

  .accent {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }

  .good {
    background: var(--color-good-soft);
    color: var(--color-good);
  }

  .warn {
    background: var(--color-warn-soft);
    color: var(--color-warn);
  }

  .danger {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
</style>
