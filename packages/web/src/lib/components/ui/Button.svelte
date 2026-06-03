<script lang="ts">
  import type { Snippet } from "svelte";
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "../../utils/cn";

  const buttonVariants = cva(
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap select-none cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    {
      variants: {
        variant: {
          primary:
            "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
          secondary:
            "border-border bg-secondary text-secondary-foreground hover:bg-accent",
          ghost:
            "text-muted-foreground hover:bg-accent hover:text-foreground data-[active]:bg-accent data-[active]:text-foreground",
          danger:
            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          toolbar:
            "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground data-[active]:bg-accent data-[active]:text-foreground",
          icon: "text-muted-foreground hover:bg-accent hover:text-foreground data-[active]:bg-accent data-[active]:text-foreground",
        },
        size: {
          xs: "h-6 px-2 text-[11px]",
          sm: "h-7 px-2.5 text-xs",
          md: "h-8 px-3 text-sm",
          lg: "h-9 px-4 text-sm",
          icon: "size-7 p-0",
        },
      },
      defaultVariants: {
        variant: "primary",
        size: "md",
      },
    },
  );

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
