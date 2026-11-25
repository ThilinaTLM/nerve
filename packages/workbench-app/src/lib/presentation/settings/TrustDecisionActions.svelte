<!--
  The same decision buttons on every item page: Needs review offers Review and
  trust and Decline, Trusted offers Revoke (which declines), Declined offers
  only Review and trust. There is no "ask again".
-->
<script lang="ts">
import type { TrustState } from "@nervekit/contracts/core";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let {
  state,
  busy = false,
  trustLabel = "Review and trust",
  onTrust,
  onDecline,
  onRevoke,
  review,
}: {
  state: TrustState;
  busy?: boolean;
  trustLabel?: string;
  onTrust?: () => void;
  onDecline?: () => void;
  /** Withdraws trust; the item becomes Declined. */
  onRevoke?: () => void;
  /** Replaces the trust button, e.g. one that opens a review dialog. */
  review?: Snippet;
} = $props();
</script>

{#snippet trust()}
  {#if review}{@render review()}{:else if onTrust}<Button
      size="sm"
      variant="outline"
      disabled={busy}
      onclick={onTrust}>{trustLabel}</Button
    >{/if}
{/snippet}

{#if state === "needs_review"}
  {@render trust()}
  {#if onDecline}<Button
      size="sm"
      variant="outline"
      disabled={busy}
      onclick={onDecline}>Decline</Button
    >{/if}
{:else if state === "declined"}
  {@render trust()}
{:else if onRevoke}
  <Button size="sm" variant="outline" disabled={busy} onclick={onRevoke}
    >Revoke</Button
  >
{/if}
