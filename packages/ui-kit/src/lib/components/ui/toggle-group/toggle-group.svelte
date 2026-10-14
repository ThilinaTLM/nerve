<script lang="ts" module>
import { getContext, setContext } from "svelte";
import { type VariantProps, tv } from "tailwind-variants";

export const toggleVariants = tv({
  base: "hover:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground aria-pressed:hover:bg-selected focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive gap-1 rounded-md text-sm font-medium transition-[color,box-shadow] [&_svg:not([class*='size-'])]:size-4 group/toggle hover:bg-muted inline-flex items-center justify-center whitespace-nowrap outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_[data-slot=toggle-count]]:text-[0.6875rem] [&_[data-slot=toggle-count]]:font-normal [&_[data-slot=toggle-count]]:tabular-nums [&_[data-slot=toggle-count]]:text-muted-foreground",
  variants: {
    variant: {
      outline: "border-input hover:bg-muted border bg-transparent shadow-xs",
      // Segmented chip: pick from a short set, optionally carrying a count.
      // Selection uses the shared fill without a border; keyboard focus keeps
      // the base focus-visible ring.
      chip: "cursor-pointer bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:bg-selected data-[state=on]:text-foreground data-[state=on]:hover:bg-selected",
    },
    size: {
      default:
        "h-control min-w-control px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
      sm: "h-control-sm min-w-control-sm px-1.5 text-xs [&_svg:not([class*='size-'])]:size-3 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1",
    },
  },
  defaultVariants: {
    variant: "outline",
    size: "default",
  },
});

export type ToggleVariants = VariantProps<typeof toggleVariants>;

interface ToggleGroupContext extends ToggleVariants {
  spacing?: number;
  orientation?: "horizontal" | "vertical";
}

export function setToggleGroupCtx(props: ToggleGroupContext) {
  setContext("toggleGroup", props);
}

export function getToggleGroupCtx() {
  return getContext<Required<ToggleGroupContext>>("toggleGroup");
}
</script>

<script lang="ts">
import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
import { cn } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  value = $bindable(),
  class: className,
  size = "default",
  spacing = 0,
  orientation = "horizontal",
  variant = "outline",
  ...restProps
}: ToggleGroupPrimitive.RootProps &
  ToggleVariants & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  } = $props();

setToggleGroupCtx({
  get variant() {
    return variant;
  },
  get size() {
    return size;
  },
  get spacing() {
    return spacing;
  },
  get orientation() {
    return orientation;
  },
});
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<ToggleGroupPrimitive.Root
  bind:value={value as never}
  bind:ref
  {orientation}
  data-slot="toggle-group"
  data-variant={variant}
  data-size={size}
  data-spacing={spacing}
  style={`--gap: ${spacing}`}
  class={cn(
    "rounded-md data-[spacing=0]:data-[variant=outline]:shadow-xs group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] data-vertical:flex-col data-vertical:items-stretch",
    className,
  )}
  {...restProps}
/>
