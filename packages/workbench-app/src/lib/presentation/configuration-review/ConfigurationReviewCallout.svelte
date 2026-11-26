<!--
  The one decision notice at the top of an item's page or of the list a file
  belongs to: Waiting for your review (warning) with Decline · Trust, a quiet
  Declined line with Trust, and, where the page asks, a quiet Trusted line
  with Revoke. Trust opens the review dialog as confirmation.
-->
<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type { TrustState } from "@nervekit/contracts/core";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import TrustDecisionActions from "$lib/presentation/settings/TrustDecisionActions.svelte";

let {
  state,
  subject,
  effect = "it is not used",
  changedSinceDecision = false,
  busy = false,
  error,
  showTrusted = false,
  onTrust,
  onDecline,
  onRevoke,
}: {
  state: TrustState;
  /** What the item is, as the start of a sentence ("This project's permission rules file"); absent on the item's own page. */
  subject?: string;
  /** What not trusting it means, as a clause ("its rule overrides don't apply"). */
  effect?: string;
  changedSinceDecision?: boolean;
  busy?: boolean;
  /** Replaces the explanation when a decision failed. */
  error?: string;
  /** Also show the trusted state, with Revoke. */
  showTrusted?: boolean;
  onTrust?: () => void;
  onDecline?: () => void;
  onRevoke?: () => void;
} = $props();

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const lower = $derived(
  subject ? subject.charAt(0).toLowerCase() + subject.slice(1) : "it",
);
const waitingTitle = $derived(
  subject ? `${subject} is waiting for your review` : "Waiting for your review",
);
const waitingText = $derived(
  `${changedSinceDecision ? "Changed outside Nerve's settings. " : ""}Until you trust it, ${effect}.`,
);
</script>

{#snippet actions()}
  <TrustDecisionActions {state} {busy} {onTrust} {onDecline} {onRevoke} />
{/snippet}

{#if state === "needs_review"}
  <Callout
    layout="block"
    tone="warning"
    icon={ShieldCheck}
    title={waitingTitle}
    text={error ?? waitingText}
    {actions}
  />
{:else if state === "declined"}
  <Callout
    layout="block"
    icon={ShieldCheck}
    title={`You declined ${lower}`}
    text={error ??
      `${changedSinceDecision ? "It changed since. " : ""}${sentence(effect)}.`}
    {actions}
  />
{:else if showTrusted}
  <Callout
    layout="block"
    icon={ShieldCheck}
    text={error ??
      `${subject ? `${subject} is trusted` : "Trusted"}. Edits you make in Nerve keep it trusted.`}
    {actions}
  />
{/if}
