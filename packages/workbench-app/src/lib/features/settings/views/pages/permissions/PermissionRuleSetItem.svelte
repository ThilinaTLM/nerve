<!--
  One rule set in the list: a plain row that opens the rule set's detail page.
  The overrides summary is the status line; a user rule set changed outside
  Nerve shows "Waiting for your review" with Review instead.
-->
<script lang="ts">
import { PageItem } from "@nervekit/ui-kit/components/composites/page";
import type {
  PermissionPolicyConfiguration,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import type { PendingReviewState } from "$lib/application/configuration-review/review-resource-state";
import { TrustStateBadge } from "$lib/presentation/settings";
import PermissionRuleSetBadges from "./PermissionRuleSetBadges.svelte";
import { overlaySummary } from "./permission-rule-sets-view";

type Props = {
  ruleSet: PermissionRuleSetSummary;
  configuration: PermissionPolicyConfiguration;
  isDefault: boolean;
  /** A user rule set changed outside Nerve waits for review, or was declined. */
  reviewState?: PendingReviewState;
  onOpen: () => void;
  /** Opens the review dialog on the rule set. */
  onReview?: () => void;
};

let {
  ruleSet,
  configuration,
  isDefault,
  reviewState,
  onOpen,
  onReview,
}: Props = $props();
const waiting = $derived(reviewState === "needs_review");
</script>

<PageItem
  title={ruleSet.name}
  summary={overlaySummary(configuration, ruleSet.id).label}
  problem={waiting ? "Waiting for your review" : undefined}
  problemAction={waiting && onReview
    ? { label: "Review", onclick: onReview }
    : undefined}
  {onOpen}
  openLabel={`Open ${ruleSet.name}`}
>
  {#snippet badges()}
    {#if reviewState === "declined"}<TrustStateBadge state="declined" />{/if}
    <PermissionRuleSetBadges {ruleSet} {isDefault} />
  {/snippet}
</PageItem>
