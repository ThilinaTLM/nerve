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
    gap: 0.5rem;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    font-weight: 800;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition:
      transform 140ms ease,
      border-color 140ms ease,
      background 140ms ease,
      color 140ms ease,
      box-shadow 140ms ease,
      opacity 140ms ease;
  }

  .ui-button:hover:not(:disabled) {
    transform: translateY(-1px);
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
    min-height: 2rem;
    padding: 0.35rem 0.65rem;
    font-size: 0.78rem;
  }

  .md {
    min-height: 2.6rem;
    padding: 0.62rem 0.95rem;
    font-size: 0.9rem;
  }

  .lg {
    min-height: 3.2rem;
    padding: 0.82rem 1.15rem;
    font-size: 0.98rem;
  }

  .primary {
    background: var(--gradient-accent);
    color: var(--color-accent-ink);
    box-shadow: var(--shadow-glow);
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
