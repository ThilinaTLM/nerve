<!--
  The one review dialog for every kind of configuration: what the item can do,
  where its source is, and the decision on exactly this version. Steps through
  a queue ("2 of 4"). Stateless: the app's host owns the queue and the calls.
-->
<script lang="ts">
import type { ConfigurationReview } from "@nervekit/contracts/configuration";
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import PenLine from "@lucide/svelte/icons/pen-line";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import TrustDecisionActions from "$lib/presentation/settings/TrustDecisionActions.svelte";
import TrustStateBadge from "$lib/presentation/settings/TrustStateBadge.svelte";
import ReviewCapabilityList from "./ReviewCapabilityList.svelte";
import ReviewSourceList from "./ReviewSourceList.svelte";
import { REVIEW_KIND_ICONS } from "./review-icons";
import { reviewChangeLine, reviewKindLine } from "./review-format";

let {
  open,
  review,
  loading = false,
  position = 0,
  total = 1,
  busy = false,
  error,
  notice,
  now = Date.now(),
  onClose,
  onPrevious,
  onNext,
  onSkip,
  onTrust,
  onDecline,
  onRetry,
  onDetails,
  onOpenSource,
}: {
  open: boolean;
  /** The current item's review; absent while it loads or after a failed read. */
  review?: ConfigurationReview;
  loading?: boolean;
  /** Zero-based place of the current item in the queue. */
  position?: number;
  total?: number;
  busy?: boolean;
  /** Reading or deciding failed. */
  error?: string;
  /** The item changed under the user; the review shown is the new one. */
  notice?: string;
  /** For "2 min ago". */
  now?: number;
  /** ✕ or Escape: closes the whole queue. */
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Not now: the next item, or close after the last. */
  onSkip: () => void;
  onTrust: () => void;
  /** Declines a waiting item, or revokes a trusted one. */
  onDecline: () => void;
  onRetry?: () => void;
  /** Goes to the item's page in Settings; absent on the phone. */
  onDetails?: () => void;
  /** Opens one source file; absent on the phone. */
  onOpenSource?: (path: string) => void;
} = $props();

const Icon = $derived(
  review ? REVIEW_KIND_ICONS[review.target.kind] : undefined,
);
const change = $derived(review ? reviewChangeLine(review, now) : undefined);
const highlight = $derived(review?.state !== "trusted");
</script>

<DialogShell
  {open}
  size="md"
  title={review
    ? review.state === "trusted"
      ? `“${review.name}”`
      : `Trust “${review.name}”?`
    : "Review"}
  description={review ? reviewKindLine(review) : undefined}
  closeLabel="Close review"
  onOpenChange={(next) => {
    if (!next) onClose();
  }}
>
  {#snippet leading()}
    {#if Icon}
      <span
        class="flex size-8 items-center justify-center rounded-md border bg-card"
      >
        <Icon class="size-4" aria-hidden="true" />
      </span>
    {/if}
  {/snippet}
  {#snippet titleExtra()}
    {#if review}
      <TrustStateBadge
        state={review.state}
        changedSinceDecision={review.changedSinceDecision}
      />
    {/if}
  {/snippet}
  {#snippet headerActions()}
    {#if total > 1}
      <div class="flex flex-none items-center gap-1 whitespace-nowrap">
        <span
          class="text-caption text-muted-foreground tabular-nums max-sm:sr-only"
          >{position + 1} of {total}</span
        >
        <IconAction
          icon={ChevronLeft}
          label="Previous"
          disabled={position <= 0 || busy}
          onclick={() => onPrevious?.()}
        />
        <IconAction
          icon={ChevronRight}
          label="Next"
          disabled={position >= total - 1 || busy}
          onclick={() => onNext?.()}
        />
      </div>
    {/if}
  {/snippet}

  <div class="grid gap-4">
    {#if notice}
      <Callout tone="warning" icon={TriangleAlert} text={notice} />
    {/if}
    {#if error}
      <Callout tone="destructive" text={error}>
        {#snippet actions()}
          {#if !review && onRetry}
            <Button size="sm" variant="outline" onclick={onRetry}>Retry</Button>
          {/if}
        {/snippet}
      </Callout>
    {/if}

    {#if review}
      {#if change}
        <p class="flex items-center gap-1.5 text-ui text-muted-foreground">
          <PenLine class="size-3.5 flex-none" aria-hidden="true" />
          {change}
        </p>
      {/if}

      <section class="grid gap-1.5" aria-labelledby="configuration-review-can">
        <h3 id="configuration-review-can" class="text-ui font-medium">
          What it can do
        </h3>
        <ReviewCapabilityList items={review.items} {highlight} />
      </section>

      <section
        class="grid gap-1.5"
        aria-labelledby="configuration-review-source"
      >
        <h3 id="configuration-review-source" class="text-ui font-medium">
          Source
        </h3>
        <ReviewSourceList
          sources={review.sources}
          onOpen={onOpenSource}
          {highlight}
        />
      </section>

      <p class="text-ui text-muted-foreground">
        {review.state === "trusted"
          ? "You trusted this exact version. Revoke turns it off."
          : "Trust covers this exact version. A change outside Nerve asks again."}
      </p>
    {:else if loading}
      <div class="grid gap-2" aria-busy="true">
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-16 w-full" />
        <Skeleton class="h-9 w-full" />
      </div>
    {/if}
  </div>

  {#snippet footer()}
    {#if onDetails && review}
      <Button variant="ghost" class="mr-auto" onclick={onDetails}
        >Details</Button
      >
    {/if}
    {#if review}
      <TrustDecisionActions
        variant="dialog"
        state={review.state}
        {busy}
        {onSkip}
        {onTrust}
        {onDecline}
        onRevoke={onDecline}
      />
    {:else}
      <Button variant="ghost" onclick={onSkip}
        >{position < total - 1 ? "Not now" : "Close"}</Button
      >
    {/if}
  {/snippet}
</DialogShell>
