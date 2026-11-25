<!--
  The one notice at the top of a layered page about one of the project's
  settings files, decided right here. Needs review and Declined lock the
  project's column (the project uses User's values); a trusted file shows a
  quiet line with Revoke only where the page asks for it.
-->
<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type { TrustState } from "@nervekit/contracts/core";
import type { Snippet } from "svelte";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { TrustDecisionActions } from "$lib/presentation/settings";

let {
  state,
  subject = "This project's settings file",
  effect = "the project uses your settings and its column is locked",
  busy = false,
  error,
  showTrusted = false,
  onTrust,
  onDecline,
  onRevoke,
  review,
}: {
  state: TrustState;
  /** What the file is, as the start of a sentence. */
  subject?: string;
  /** What not trusting it means, as a clause. */
  effect?: string;
  busy?: boolean;
  /** Replaces the explanation when a decision failed. */
  error?: string;
  /** Also show the trusted state, with Revoke. */
  showTrusted?: boolean;
  onTrust?: () => void;
  onDecline?: () => void;
  onRevoke?: () => void;
  /** Replaces the trust button, e.g. one that opens a review dialog. */
  review?: Snippet;
} = $props();

const lower = $derived(subject.charAt(0).toLowerCase() + subject.slice(1));
</script>

{#snippet actions()}
  <TrustDecisionActions
    {state}
    {busy}
    {onTrust}
    {onDecline}
    {onRevoke}
    {review}
  />
{/snippet}

{#if state === "needs_review"}
  <Callout
    layout="block"
    tone="warning"
    icon={ShieldCheck}
    title={`${subject} needs your review`}
    text={error ?? `Until you trust it, ${effect}.`}
    {actions}
  />
{:else if state === "declined"}
  <Callout
    layout="block"
    icon={ShieldCheck}
    title={`You declined ${lower}`}
    text={error ?? `${effect.charAt(0).toUpperCase()}${effect.slice(1)}.`}
    {actions}
  />
{:else if showTrusted}
  <Callout
    layout="block"
    icon={ShieldCheck}
    text={error ??
      `${subject} is trusted. Edits you make in Nerve keep it trusted.`}
    {actions}
  />
{/if}
