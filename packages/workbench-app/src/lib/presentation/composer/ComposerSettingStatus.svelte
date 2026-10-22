<script lang="ts">
import Lock from "@lucide/svelte/icons/lock";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import { Button } from "@nervekit/ui-kit/components/ui/button";

/**
 * Next to a composer control: a lock chip when the applied profile holds the
 * value, or a dot with ↺ when an unlocked value differs from the effective
 * settings.
 */
let {
  label,
  lockedBy,
  differs = false,
  disabled = false,
  onReset,
}: {
  /** The setting, e.g. "Model". */
  label: string;
  lockedBy?: string;
  differs?: boolean;
  disabled?: boolean;
  onReset?: () => void;
} = $props();
</script>

{#if lockedBy}
  <span
    class="inline-flex h-control-sm min-w-0 flex-none items-center gap-1 rounded-md px-1 text-xs text-muted-foreground"
    role="img"
    aria-label={`${label} locked by ${lockedBy}`}
    title={`${label} is locked by the ${lockedBy} profile`}
  >
    <Lock class="size-3 flex-none" aria-hidden="true" />
    <span class="max-w-28 truncate @max-[560px]/composer-toolbar:hidden"
      >Locked by {lockedBy}</span
    >
  </span>
{:else if differs && onReset}
  <Button
    variant="ghost"
    size="icon-sm"
    type="button"
    {disabled}
    class="relative flex-none text-muted-foreground"
    ariaLabel={`Reset ${label} to your settings`}
    title={`${label} differs from your settings. Reset`}
    onclick={onReset}
  >
    <RotateCcw class="size-3" aria-hidden="true" />
    <span
      class="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
      aria-hidden="true"
    ></span>
  </Button>
{/if}
