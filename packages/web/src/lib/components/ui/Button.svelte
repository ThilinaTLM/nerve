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
    gap: 0.375rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-weight: var(--weight-semibold);
    letter-spacing: 0;
    white-space: nowrap;
    user-select: none;
    cursor: pointer;
    transition:
      border-color 110ms ease,
      background 110ms ease,
      color 110ms ease,
      box-shadow 110ms ease,
      opacity 110ms ease,
      filter 110ms ease;
  }

  .ui-button:focus-visible {
    outline: 1px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  .ui-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .xs {
    min-height: var(--control-height-xs);
    padding: 0.05rem 0.45rem;
    font-size: var(--text-2xs);
  }

  .sm {
    min-height: var(--control-height-sm);
    padding: 0.18rem 0.6rem;
    font-size: var(--text-xs);
  }

  .md {
    min-height: var(--control-height-md);
    padding: 0.28rem 0.75rem;
    font-size: var(--text-sm);
  }

  .lg {
    min-height: var(--control-height-lg);
    padding: 0.4rem 0.95rem;
    font-size: var(--text-md);
  }

  .icon-size {
    width: var(--control-height-sm);
    min-width: var(--control-height-sm);
    height: var(--control-height-sm);
    min-height: var(--control-height-sm);
    padding: 0;
  }

  .primary {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-accent-ink);
  }

  .primary:hover:not(:disabled) {
    border-color: var(--color-accent-strong);
    background: var(--color-accent-strong);
  }

  .primary:active:not(:disabled) {
    filter: brightness(0.96);
  }

  .secondary {
    border-color: var(--color-border);
    background: var(--color-panel);
    color: var(--color-text);
  }

  .secondary:hover:not(:disabled),
  .secondary[data-active] {
    border-color: var(--color-border-strong);
    background: var(--color-panel-raised);
  }

  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--color-muted);
  }

  .ghost:hover:not(:disabled),
  .ghost[data-active] {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
    color: var(--color-text);
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
    border-color: color-mix(in srgb, var(--color-danger) 70%, transparent);
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  .danger:hover:not(:disabled) {
    border-color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger-soft) 84%, var(--color-danger));
  }
</style>
