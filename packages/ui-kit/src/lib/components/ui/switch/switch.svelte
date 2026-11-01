<script lang="ts">
import { Switch as SwitchPrimitive } from "bits-ui";
import { cn, type WithoutChildrenOrChild } from "@nervekit/ui-kit/utils";

let {
  ref = $bindable(null),
  class: className,
  checked = $bindable(false),
  disabled = false,
  busy = false,
  ...restProps
}: WithoutChildrenOrChild<SwitchPrimitive.RootProps> & {
  busy?: boolean;
} = $props();
</script>

<SwitchPrimitive.Root
  bind:ref
  bind:checked
  data-slot="switch"
  class={cn(
    "data-checked:bg-primary data-unchecked:bg-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/30 aria-invalid:border-destructive shrink-0 rounded-full border border-transparent shadow-xs focus-visible:ring-3 aria-invalid:ring-3 h-4 w-7 p-0.5 peer group/switch relative inline-flex items-center transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed",
    disabled && "data-disabled:opacity-50",
    className,
  )}
  {...restProps}
  disabled={disabled || busy}
  aria-busy={busy}
>
  <SwitchPrimitive.Thumb
    data-slot="switch-thumb"
    class="bg-background data-checked:bg-primary-foreground size-3 data-checked:translate-x-3 data-unchecked:translate-x-0 pointer-events-none block rounded-full ring-0 transition-transform rtl:data-[state=checked]:translate-x-[calc(-100%)]"
  />
</SwitchPrimitive.Root>
