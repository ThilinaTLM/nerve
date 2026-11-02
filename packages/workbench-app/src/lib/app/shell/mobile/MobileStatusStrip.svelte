<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { mobileBanner, mobileStatusSheet } from "./mobile-status.svelte";

/**
 * Away-from-desk health. The header subtitle already says "connected"; this
 * adds a full-width banner only when the daemon is unreachable or a provider
 * is close to its limit. Tapping it opens the details sheet.
 */
const banner = $derived(mobileBanner());
</script>

{#if banner}
  <button
    type="button"
    class={[
      "flex min-h-11 w-full items-center gap-2 px-3 text-left text-ui",
      banner.tone === "destructive"
        ? "bg-destructive-subtle text-destructive"
        : "bg-warning-subtle text-warning",
    ]}
    onclick={() => (mobileStatusSheet.open = true)}
  >
    <TriangleAlert size={16} strokeWidth={2} class="flex-none" />
    <span class="min-w-0 flex-1 truncate">{banner.message}</span>
    <span class="flex-none text-caption text-muted-foreground">Details</span>
  </button>
{/if}
