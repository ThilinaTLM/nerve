<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../../utils/cn";

  type Props = {
    children?: Snippet;
    class?: string;
    tone?: "neutral" | "accent" | "good" | "warn" | "danger" | "running";
    size?: "xs" | "sm";
    title?: string;
  };

  let { children, class: className = "", tone = "neutral", size = "sm", title }: Props = $props();
</script>

<span class={cn("ui-badge", tone, size, className)} {title}>
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
    font-weight: var(--weight-semibold);
    letter-spacing: 0;
    line-height: 1.2;
    white-space: nowrap;
  }

  .xs {
    padding: 0.06rem 0.28rem;
    font-size: var(--text-2xs);
  }

  .sm {
    padding: 0.1rem 0.35rem;
    font-size: var(--text-xs);
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
