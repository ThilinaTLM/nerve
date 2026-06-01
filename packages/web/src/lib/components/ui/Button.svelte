<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "primary" | "secondary" | "ghost" | "danger";
  type Size = "sm" | "md" | "lg";

  type Props = {
    children?: Snippet;
    class?: string;
    variant?: Variant;
    size?: Size;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    title?: string;
    onclick?: (event: MouseEvent) => void;
  };

  let {
    children,
    class: className = "",
    variant = "primary",
    size = "md",
    type = "button",
    disabled = false,
    title,
    onclick,
  }: Props = $props();
</script>

<button class={`ui-button ${variant} ${size} ${className}`} {type} {disabled} {title} {onclick}>
  {@render children?.()}
</button>

<style>
  .ui-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-weight: 650;
    letter-spacing: 0;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background 120ms ease,
      color 120ms ease,
      opacity 120ms ease;
  }

  .ui-button:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .ui-button:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .sm {
    min-height: 1.5rem;
    padding: 0.2rem 0.5rem;
    font-size: 0.72rem;
  }

  .md {
    min-height: 1.8rem;
    padding: 0.3rem 0.65rem;
    font-size: 0.78rem;
  }

  .lg {
    min-height: 2rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.82rem;
  }

  .primary {
    background: var(--color-accent);
    color: var(--color-accent-ink);
  }

  .secondary {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .ghost {
    border-color: var(--color-border-subtle);
    background: transparent;
    color: var(--color-accent);
  }

  .danger {
    background: var(--color-danger);
    color: white;
  }
</style>
