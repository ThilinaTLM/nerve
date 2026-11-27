<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
let {
  onResolve,
  onReview,
}: {
  onResolve?: (decision: "retry" | "cancel") => Promise<void>;
  /** The call waits for a file the user has not reviewed: Review opens it. */
  onReview?: () => void;
} = $props();
let busy = $state(false);
let error = $state<string>();
async function resolve(decision: "retry" | "cancel") {
  if (busy || !onResolve) return;
  busy = true;
  error = undefined;
  try {
    await onResolve(decision);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy = false;
  }
}
</script>
{#if error}<span class="text-ui text-destructive" role="alert">{error}</span
  >{/if}
{#if onReview}<Button size="sm" disabled={busy} onclick={onReview}
    ><ShieldCheck class="size-3.5" />Review</Button
  >{/if}
<Button
  size="sm"
  variant={onReview ? "outline" : "default"}
  disabled={busy || !onResolve}
  onclick={() => resolve("retry")}
  >{#if busy}<Spinner class="size-3.5" />{:else}<RotateCcw
      class="size-3.5"
    />{/if}Retry</Button
>
<Button
  size="sm"
  variant="outline"
  disabled={busy || !onResolve}
  onclick={() => resolve("cancel")}><X class="size-3.5" />Cancel</Button
>
