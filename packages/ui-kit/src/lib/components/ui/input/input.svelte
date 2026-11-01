<script lang="ts">
import type {
  HTMLInputAttributes,
  HTMLInputTypeAttribute,
} from "svelte/elements";
import { cn, type WithElementRef } from "@nervekit/ui-kit/utils";

type InputType = Exclude<HTMLInputTypeAttribute, "file">;

type Props = WithElementRef<
  Omit<HTMLInputAttributes, "type" | "size"> &
    (
      | { type: "file"; files?: FileList }
      | { type?: InputType; files?: undefined }
    )
> & {
  /** Convenience alias for `aria-label`. */
  ariaLabel?: string;
};

let {
  ref = $bindable(null),
  value = $bindable(),
  type,
  files = $bindable(),
  class: className,
  ariaLabel,
  "data-slot": dataSlot = "input",
  ...restProps
}: Props = $props();
</script>

{#if type === "file"}
  <input
    bind:this={ref}
    data-slot={dataSlot}
    aria-label={ariaLabel}
    class={cn(
      "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/30 aria-invalid:border-destructive h-control rounded-md border bg-input-background px-2 py-1 text-ui shadow-xs transition-[color,box-shadow] file:h-5 file:text-ui file:font-medium focus-visible:ring-3 aria-invalid:ring-3 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
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
      "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/30 aria-invalid:border-destructive h-control rounded-md border bg-transparent px-2 py-1 text-ui shadow-xs transition-[color,box-shadow] file:h-5 file:text-ui file:font-medium focus-visible:ring-3 aria-invalid:ring-3 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {type}
    bind:value
    {...restProps}
  />
{/if}
