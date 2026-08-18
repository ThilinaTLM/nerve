<script lang="ts">
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  id: string;
  checked?: boolean;
  title: string;
  description: string;
  /** Optional trailing numeric input (for "older than N days" choices). */
  amount?: number;
  amountLabel?: string;
  amountSuffix?: string;
  amountMin?: number;
  amountMax?: number;
};

let {
  id,
  checked = $bindable(false),
  title,
  description,
  amount = $bindable(),
  amountLabel,
  amountSuffix,
  amountMin = 1,
  amountMax = 3650,
}: Props = $props();

const hasAmount = $derived(amount !== undefined);
</script>

<div
  class={cn(
    "flex items-center gap-3 rounded-md border bg-accent/90 px-3 py-2 transition-colors hover:bg-accent/95 dark:bg-accent/60 dark:hover:bg-accent/70",
    checked ? "border-primary" : "border-transparent",
  )}
>
  <Checkbox {id} bind:checked aria-label={title} />
  <Label
    for={id}
    class="grid min-w-0 flex-1 cursor-pointer gap-0.5 font-normal"
  >
    <span class="text-sm text-foreground">{title}</span>
    <span class="text-xs text-muted-foreground">{description}</span>
  </Label>
  {#if hasAmount}
    <div class="flex items-center gap-2">
      <Input
        type="number"
        size="xs"
        min={amountMin}
        max={amountMax}
        value={String(amount)}
        disabled={!checked}
        ariaLabel={amountLabel ?? `${title} amount`}
        class="w-20"
        oninput={(event) =>
          (amount = Number((event.currentTarget as HTMLInputElement).value))}
      />
      {#if amountSuffix}
        <span class="text-xs text-muted-foreground">{amountSuffix}</span>
      {/if}
    </div>
  {/if}
</div>
