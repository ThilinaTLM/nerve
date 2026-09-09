<script lang="ts" module>
import { type VariantProps, tv } from "tailwind-variants";

export const toggleVariants = tv({
  base: "hover:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:hover:bg-selected focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive gap-1 rounded-md text-sm font-medium transition-[color,box-shadow] [&_svg:not([class*='size-'])]:size-4 group/toggle hover:bg-muted inline-flex items-center justify-center whitespace-nowrap outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_[data-slot=toggle-count]]:text-[0.6875rem] [&_[data-slot=toggle-count]]:font-normal [&_[data-slot=toggle-count]]:tabular-nums [&_[data-slot=toggle-count]]:text-muted-foreground",
  variants: {
    variant: {
      default: "bg-transparent",
      outline: "border-input hover:bg-muted border bg-transparent shadow-xs",
      // Segmented chip: the one control for "pick from a short set", optionally
      // carrying a count. Square corners tie a chip row to the option rows it
      // sits with, and the on-state is the same tint + primary edge a selected
      // row uses, so selection means one thing across the app.
      chip: "cursor-pointer border border-input bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-selected data-[state=on]:text-foreground data-[state=on]:hover:bg-selected",
    },
    size: {
      default:
        "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      xs: "h-6 min-w-6 px-1.5 text-xs [&_svg:not([class*='size-'])]:size-3 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1",
      sm: "h-7 min-w-7 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
      lg: "h-9 min-w-9 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export type ToggleVariant = VariantProps<typeof toggleVariants>["variant"];
export type ToggleSize = VariantProps<typeof toggleVariants>["size"];
export type ToggleVariants = VariantProps<typeof toggleVariants>;
</script>

<script lang="ts">
import { Toggle as TogglePrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  pressed = $bindable(false),
  class: className,
  size = "default",
  variant = "default",
  ...restProps
}: TogglePrimitive.RootProps & {
  variant?: ToggleVariant;
  size?: ToggleSize;
} = $props();
</script>

<TogglePrimitive.Root
  bind:ref
  bind:pressed
  data-slot="toggle"
  class={cn(toggleVariants({ variant, size }), className)}
  {...restProps}
/>
