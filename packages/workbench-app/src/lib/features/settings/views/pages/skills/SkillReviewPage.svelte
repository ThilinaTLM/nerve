<!--
  Settings › Skills › name: the page of a user or project skill that needs
  the user's decision. A "Waiting for your review" callout with the decision,
  then what the skill can do and the files the decision covers, scripts
  marked, each one click away. SKILL.md is not inlined.
-->
<script lang="ts">
import {
  PageEmptyState,
  PageHeader,
} from "@nervekit/ui-kit/components/composites/page";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { reviewKindLine } from "$lib/presentation/configuration-review/review-format";
import ConfigurationReviewCallout from "$lib/presentation/configuration-review/ConfigurationReviewCallout.svelte";
import ConfigurationReviewSections from "$lib/presentation/configuration-review/ConfigurationReviewSections.svelte";
import { useItemReview } from "../review/item-review.svelte";

let {
  scope,
  projectId,
  name,
  onBack,
  onOpenFile,
}: {
  scope: "user" | "project";
  /** Required for a project skill. */
  projectId?: string;
  name: string;
  /** Returns to the Skills list. */
  onBack: () => void;
  /** Opens one file of the skill by absolute path. */
  onOpenFile?: (path: string) => void;
} = $props();

const item = useItemReview(() => ({
  kind: "skill",
  scope,
  ...(scope === "project" && projectId ? { projectId } : {}),
  id: name,
}));
const session = $derived(item.current);
const review = $derived(session?.review);
</script>

<PageHeader
  title={name}
  description={review
    ? reviewKindLine(review)
    : session?.phase === "error"
      ? undefined
      : scope === "project"
        ? "Skill · Project"
        : "Skill · User"}
  parent={{ label: "Skills", onBack }}
/>

{#if session?.notice}
  <Callout tone="warning" icon={TriangleAlert} text={session.notice} />
{/if}

{#if !session || session.phase === "loading"}
  <Skeleton class="h-24 w-full" />
{:else if session.phase === "error"}
  <PageEmptyState
    variant="card"
    title="Skill not available"
    description={session.error ??
      `There is no skill named "${name}" here any more. It may have been renamed, moved or deleted.`}
  >
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={() => void session.load()}
        >Retry</Button
      >
      <Button size="sm" variant="outline" onclick={onBack}
        >Back to Skills</Button
      >
    {/snippet}
  </PageEmptyState>
{:else if review}
  <ConfigurationReviewCallout
    state={review.state}
    effect="the agent is not told about it"
    changedSinceDecision={review.changedSinceDecision}
    busy={session.busy}
    error={session.error}
    showTrusted
    onTrust={() => session.trust()}
    onDecline={() => void session.decline()}
    onRevoke={() => void session.decline()}
  />
  <ConfigurationReviewSections {review} onOpenSource={onOpenFile} />
{/if}
