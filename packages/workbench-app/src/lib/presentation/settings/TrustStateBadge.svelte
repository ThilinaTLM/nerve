<!-- The decision state of a project item: Needs review, Trusted or Declined, explained on hover. -->
<script lang="ts">
import type { TrustState } from "@nervekit/contracts/core";
import TipBadge from "./TipBadge.svelte";
import {
  TRUST_STATE_LABELS,
  TRUST_STATE_TONES,
  trustStateTip,
} from "./trust-state";

let {
  state,
  changedSinceDecision = false,
  tip,
}: {
  state: TrustState;
  /** The content differs from the one decided on; only adds to the tooltip. */
  changedSinceDecision?: boolean;
  /** Replaces the default explanation. */
  tip?: string;
} = $props();
</script>

<TipBadge
  text={TRUST_STATE_LABELS[state]}
  tip={tip ?? trustStateTip(state, changedSinceDecision)}
  variant={TRUST_STATE_TONES[state]}
/>
