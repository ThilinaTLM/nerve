<!--
  The one set of decision buttons, in the review dialog and on item pages:
  Needs review offers Decline and Trust, Declined only Trust, Trusted Revoke
  (which declines). The dialog adds Not now before them. There is no "ask
  again". On a page, Trust opens the review dialog as confirmation.
-->
<script lang="ts">
import type { TrustState } from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let {
  state,
  busy = false,
  variant = "page",
  onTrust,
  onDecline,
  onRevoke,
  onSkip,
}: {
  state: TrustState;
  busy?: boolean;
  /** `dialog`: full-size footer buttons with Not now; `page`: small ones for a header or callout. */
  variant?: "page" | "dialog";
  onTrust?: () => void;
  onDecline?: () => void;
  /** Withdraws trust; the item becomes Declined. */
  onRevoke?: () => void;
  /** Not now (dialog): leaves the item as it is. */
  onSkip?: () => void;
} = $props();

const size = $derived(variant === "dialog" ? "default" : "sm");
</script>

{#if variant === "dialog" && onSkip && state !== "trusted"}
  <Button variant="ghost" {size} autofocus disabled={busy} onclick={onSkip}
    >Not now</Button
  >
{/if}
{#if state === "trusted"}
  {#if onRevoke}<Button
      variant="outline"
      {size}
      disabled={busy}
      onclick={onRevoke}>Revoke</Button
    >{/if}
{:else}
  {#if state === "needs_review" && onDecline}<Button
      variant="outline"
      {size}
      disabled={busy}
      onclick={onDecline}>Decline</Button
    >{/if}
  {#if onTrust}<Button {size} disabled={busy} onclick={onTrust}>Trust</Button
    >{/if}
{/if}
