<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import { Button } from "@nervekit/ui-kit/components/ui/button";

/**
 * Reset an unlocked composer value that differs from the effective settings.
 */
let {
  label,
  differs = false,
  disabled = false,
  onReset,
}: {
  /** The setting, e.g. "Model". */
  label: string;
  differs?: boolean;
  disabled?: boolean;
  onReset?: () => void;
} = $props();
</script>

{#if differs && onReset}
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
