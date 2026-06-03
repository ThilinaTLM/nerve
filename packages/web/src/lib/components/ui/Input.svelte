<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { cva, type VariantProps } from "class-variance-authority";
  import { cn } from "../../utils/cn";

  const inputVariants = cva(
    "ui-input w-full min-w-0 rounded-md border border-input bg-input/40 text-foreground transition-colors placeholder:text-muted-foreground/70 hover:border-ring/60 focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60 read-only:opacity-80",
    {
      variants: {
        size: {
          sm: "h-7 px-2.5 text-xs",
          md: "h-8 px-3 text-sm",
          lg: "h-9 px-3.5 text-sm",
        },
      },
      defaultVariants: {
        size: "md",
      },
    },
  );

  type Size = NonNullable<VariantProps<typeof inputVariants>["size"]>;

  type Props = {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    class?: string;
    type?: string;
    size?: Size;
    ariaLabel?: string;
    ariaLabelledby?: string;
    autocomplete?: HTMLInputAttributes["autocomplete"];
    name?: string;
    oninput?: (event: Event) => void;
    onkeydown?: (event: KeyboardEvent) => void;
  };

  let {
    value = $bindable(""),
    placeholder = "",
    disabled = false,
    readonly = false,
    class: className = "",
    type = "text",
    size = "md",
    ariaLabel,
    ariaLabelledby,
    autocomplete,
    name,
    oninput,
    onkeydown,
  }: Props = $props();
</script>

<input
  class={cn(inputVariants({ size }), className)}
  bind:value
  {placeholder}
  {disabled}
  {readonly}
  {type}
  {autocomplete}
  {name}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  {oninput}
  {onkeydown}
/>
