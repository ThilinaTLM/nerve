<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    class?: string;
    tone?: "neutral" | "accent" | "good" | "warn" | "danger" | "running";
    title?: string;
  };

  let { children, class: className = "", tone = "neutral", title }: Props = $props();
</script>

<span class={cn("ui-badge", tone, className)} {title}>
  {@render children?.()}
</span>

<style>
  .ui-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    width: fit-content;
    max-width: 100%;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    font-size: 0.68rem;
    font-weight: 650;
    letter-spacing: 0;
    line-height: 1.2;
    white-space: nowrap;
  }

  .neutral {
    background: var(--color-panel-muted);
    color: var(--color-muted);
  }

  .accent,
  .running {
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
