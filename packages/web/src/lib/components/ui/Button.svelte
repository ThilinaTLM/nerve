<script lang="ts">
  import type { Snippet } from "svelte";
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "../../utils/cn";

  const buttonVariants = cva("ui-button", {
    variants: {
      variant: {
        primary: "primary",
        secondary: "secondary",
        ghost: "ghost",
        danger: "danger",
        toolbar: "toolbar",
        icon: "icon-variant",
      },
      size: {
        xs: "xs",
        sm: "sm",
        md: "md",
        lg: "lg",
        icon: "icon-size",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  });

  type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
  type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

  type Props = {
    children?: Snippet;
    class?: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    active?: boolean;
    pressed?: boolean;
    name?: string;
    value?: string;
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
    ariaLabel,
    active = false,
    pressed,
    name,
    value,
    onclick,
  }: Props = $props();
</script>

<button
  class={cn(buttonVariants({ variant, size }), className)}
  {type}
  {disabled}
  {title}
  {name}
  {value}
  aria-label={ariaLabel}
  aria-pressed={pressed}
  data-active={active ? "" : undefined}
  {onclick}
>
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
    white-space: nowrap;
    user-select: none;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background 120ms ease,
      color 120ms ease,
      box-shadow 120ms ease,
      opacity 120ms ease;
  }

  .ui-button:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  .ui-button:disabled {
    cursor: not-allowed;
    opacity: 0.52;
  }

  .xs {
    min-height: var(--control-height-xs);
    padding: 0.08rem 0.38rem;
    font-size: 0.68rem;
  }

  .sm {
    min-height: var(--control-height-sm);
    padding: 0.18rem 0.52rem;
    font-size: 0.72rem;
  }

  .md {
    min-height: var(--control-height-md);
    padding: 0.3rem 0.68rem;
    font-size: 0.78rem;
  }

  .lg {
    min-height: var(--control-height-lg);
    padding: 0.4rem 0.85rem;
    font-size: 0.84rem;
  }

  .icon-size {
    width: var(--control-height-md);
    min-width: var(--control-height-md);
    height: var(--control-height-md);
    min-height: var(--control-height-md);
    padding: 0;
  }

  .primary {
    background: var(--color-accent);
    color: var(--color-accent-ink);
    box-shadow: var(--shadow-panel);
  }

  .primary:hover:not(:disabled) {
    filter: brightness(1.04);
  }

  .secondary {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
    color: var(--color-text);
    box-shadow: var(--shadow-panel);
  }

  .secondary:hover:not(:disabled) {
    border-color: var(--color-accent);
  }

  .ghost {
    border-color: var(--color-border-subtle);
    background: transparent;
    color: var(--color-accent);
  }

  .ghost:hover:not(:disabled),
  .ghost[data-active] {
    background: var(--color-accent-soft);
    border-color: var(--color-border);
    color: var(--color-accent-strong);
  }

  .toolbar,
  .icon-variant {
    border-color: var(--color-border-subtle);
    background: var(--color-field);
    color: var(--color-muted);
  }

  .toolbar:hover:not(:disabled),
  .toolbar[data-active],
  .icon-variant:hover:not(:disabled),
  .icon-variant[data-active] {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  .danger {
    background: var(--color-danger);
    color: white;
  }

  .danger:hover:not(:disabled) {
    filter: brightness(1.06);
  }
</style>
