<script lang="ts">
import type {
  HTMLInputAttributes,
  HTMLInputTypeAttribute,
} from "svelte/elements";
import { cn, type WithElementRef } from "@nervekit/ui-kit/core/utils";

type InputType = Exclude<HTMLInputTypeAttribute, "file">;

type Props = WithElementRef<
  Omit<HTMLInputAttributes, "type" | "size"> &
    (
      | { type: "file"; files?: FileList }
      | { type?: InputType; files?: undefined }
    )
> & {
  /** Visual height. `sm` is a denser variant for toolbars and dense forms. */
  size?: "sm" | "default";
  /** Convenience alias for `aria-label`. */
  ariaLabel?: string;
};

let {
  ref = $bindable(null),
  value = $bindable(),
  type,
  files = $bindable(),
  class: className,
  size = "default",
  ariaLabel,
  "data-slot": dataSlot = "input",
  ...restProps
}: Props = $props();

const sizeClass = $derived(size === "sm" ? "h-8" : "h-9");
</script>

{#if type === "file"}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    aria-label={ariaLabel}
    class={cn(
      "dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] file:h-7 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      sizeClass,
      className,
    )}
    type="file"
    bind:files
    bind:value
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    aria-label={ariaLabel}
    class={cn(
      "dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] file:h-7 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      sizeClass,
      className,
    )}
    {type}
    bind:value
    {...restProps}
  />
{/if}
