<script lang="ts" module>
import type {
  HTMLAnchorAttributes,
  HTMLButtonAttributes,
} from "svelte/elements";
import type { VariantProps } from "tailwind-variants";
import { cn, tv, type WithElementRef } from "@nervekit/ui-kit/utils";

export const buttonVariants = tv({
  base: "focus-visible:border-ring focus-visible:ring-focus aria-invalid:ring-destructive-strong aria-invalid:border-destructive rounded-md border border-transparent bg-clip-padding text-ui focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px aria-invalid:ring-3 data-[active]:bg-muted data-[active]:text-foreground [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:bg-primary/80",
      outline:
        "bg-input/30 hover:bg-input/50 hover:text-foreground aria-expanded:bg-input/50 aria-expanded:text-foreground",
      success:
        "bg-success text-success-foreground hover:bg-success/80 focus-visible:ring-success-strong focus-visible:border-success-strong",
      ghost:
        "hover:bg-hover hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
      destructive:
        "bg-destructive-subtle hover:bg-destructive/15 focus-visible:ring-destructive-strong text-destructive focus-visible:border-destructive-strong",
      link: "text-primary hover:bg-hover",
    },
    /* Compact desktop control scale: two heights, driven by the
     * `--spacing-control*` tokens (taller on coarse pointers). Every other
     * control in the kit derives from these. */
    size: {
      default:
        "h-control gap-1 px-2 text-ui in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
      sm: "h-control-sm gap-1 px-1.5 text-ui in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
      icon: "size-control in-data-[slot=button-group]:rounded-md",
      "icon-sm":
        "size-control-sm in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
  WithElementRef<HTMLAnchorAttributes> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Renders a `data-active` toggle state (used for active toolbar/icon buttons). */
    active?: boolean;
    /** Sets `aria-pressed` for toggle buttons. */
    pressed?: boolean;
    /** Convenience alias for `aria-label`. */
    ariaLabel?: string;
  };
</script>

<script lang="ts">
let {
  class: className,
  variant = "default",
  size = "default",
  ref = $bindable(null),
  href = undefined,
  type = "button",
  disabled,
  active = false,
  pressed,
  ariaLabel,
  children,
  ...restProps
}: ButtonProps = $props();
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    aria-label={ariaLabel}
    aria-pressed={pressed}
    data-active={active ? "" : undefined}
    role={disabled ? "link" : undefined}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    {type}
    {disabled}
    aria-label={ariaLabel}
    aria-pressed={pressed}
    data-active={active ? "" : undefined}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
