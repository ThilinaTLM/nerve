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
    border-radius: 999px;
    font-family: var(--font-mono);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.02em;
    line-height: 1.2;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .xs {
    padding: 0.06rem 0.32rem;
    font-size: var(--text-2xs);
  }

  .sm {
    padding: 0.12rem 0.42rem;
    font-size: var(--text-xs);
  }

  .neutral {
    background: var(--color-field);
    color: var(--color-muted);
  }

  .accent,
  .running {
    border-color: var(--color-accent-muted);
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }

  .good {
    border-color: color-mix(in srgb, var(--color-good) 38%, transparent);
    background: var(--color-good-soft);
    color: var(--color-good);
  }

  .warn {
    border-color: color-mix(in srgb, var(--color-warn) 38%, transparent);
    background: var(--color-warn-soft);
    color: var(--color-warn);
  }

  .danger {
    border-color: color-mix(in srgb, var(--color-danger) 38%, transparent);
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
</style>
