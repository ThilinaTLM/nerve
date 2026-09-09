<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import CircleSlash from "@lucide/svelte/icons/circle-slash";
import GitMerge from "@lucide/svelte/icons/git-merge";
import GitPullRequestDraft from "@lucide/svelte/icons/git-pull-request-draft";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  GithubChecksSummary,
  GithubPrCore,
  GithubPrMergeMethod,
  GithubPrOverview,
} from "@nervekit/contracts/git";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { SplitButton } from "@nervekit/ui-kit/components/composites/split-button";
import GitHubPrSection from "./GitHubPrSection.svelte";
import {
  defaultMergeMethod,
  formatPrDateCompact,
  mergeMethodLabel,
  mergeReadiness,
} from "./pr-pane-helpers";

type Props = {
  detail: GithubPrCore & GithubPrOverview & { checks: GithubChecksSummary };
  selectedMethod?: GithubPrMergeMethod;
  merging: boolean;
  error?: string;
  onMethodChange?: (method: GithubPrMergeMethod) => void;
  onMerge?: (method: GithubPrMergeMethod) => void;
};

let { detail, selectedMethod, merging, error, onMethodChange, onMerge }: Props =
  $props();
let confirmOpen = $state(false);

const readiness = $derived(mergeReadiness(detail));
const method = $derived(
  selectedMethod ?? defaultMergeMethod(detail.mergeSettings.allowedMethods),
);

/* A closed or merged pull request has an outcome, not a merge decision: the
 * card reports what happened instead of pretending the merge is pending. */
type Outcome = "merged" | "closed" | "draft" | "ready" | "blocked" | "unknown";
const outcome = $derived<Outcome>(
  detail.state === "MERGED"
    ? "merged"
    : detail.state === "CLOSED"
      ? "closed"
      : detail.isDraft
        ? "draft"
        : readiness.status,
);

const title = $derived(
  {
    merged: "Merged",
    closed: "Closed without merging",
    draft: "Draft pull request",
    ready: "Ready to merge",
    blocked: "Not ready to merge",
    unknown: "Checking merge status",
  }[outcome],
);

const tone = $derived(
  {
    merged: {
      icon: GitMerge,
      accent: "text-info",
      surface: "border-info/35 bg-info/8",
    },
    closed: {
      icon: CircleSlash,
      accent: "text-destructive",
      surface: "border-destructive/35 bg-destructive/8",
    },
    draft: {
      icon: GitPullRequestDraft,
      accent: "text-muted-foreground",
      surface: "",
    },
    ready: {
      icon: Check,
      accent: "text-success",
      surface: "border-success/35 bg-success/8",
    },
    blocked: {
      icon: TriangleAlert,
      accent: "text-warning",
      surface: "border-warning/35 bg-warning/8",
    },
    unknown: { icon: Spinner, accent: "text-muted-foreground", surface: "" },
  }[outcome],
);

const showMerge = $derived(
  outcome !== "merged" &&
    outcome !== "closed" &&
    detail.state === "OPEN" &&
    !detail.isDraft &&
    detail.mergeable === "MERGEABLE" &&
    detail.mergeSettings.allowedMethods.length > 0,
);

/* Reasons are the whole point of a blocked card, so they are listed verbatim;
 * finished pull requests describe the outcome instead. */
const notes = $derived.by<string[]>(() => {
  if (outcome === "merged") {
    const who = detail.mergedBy ? `${detail.mergedBy} merged` : "Merged";
    const when = detail.mergedAt
      ? ` on ${formatPrDateCompact(detail.mergedAt)}`
      : "";
    const commit = detail.mergeCommitOid
      ? [`Merge commit ${detail.mergeCommitOid.slice(0, 7)}`]
      : [];
    return [
      `${who} ${detail.headRefName} into ${detail.baseRefName}${when}`,
      ...commit,
    ];
  }
  if (outcome === "closed")
    return [
      detail.closedAt
        ? `Closed on ${formatPrDateCompact(detail.closedAt)}`
        : `${detail.headRefName} was never merged into ${detail.baseRefName}`,
    ];
  if (outcome === "draft") {
    /* A draft can still be broken; hiding that until it is marked ready would
     * make the card look clean while the branch is not. */
    const blockers: string[] = [];
    if (detail.checks.status === "failing")
      blockers.push(
        `${detail.checks.failed} of ${detail.checks.total} checks failing`,
      );
    if ((detail.behindBy ?? 0) > 0)
      blockers.push(
        `${detail.behindBy} ${detail.behindBy === 1 ? "commit" : "commits"} behind ${detail.baseRefName}`,
      );
    return [
      "Mark the pull request ready for review on GitHub to merge it.",
      ...blockers,
    ];
  }
  if (outcome === "ready")
    return [
      detail.checks.total > 0
        ? `All ${detail.checks.total} checks passed · no conflicts with ${detail.baseRefName}`
        : `No conflicts with ${detail.baseRefName}`,
    ];
  return readiness.reasons;
});
const StatusIcon = $derived(tone.icon);

function requestMerge() {
  if (method && readiness.status === "ready") confirmOpen = true;
}

function confirmMerge() {
  if (!method) return;
  confirmOpen = false;
  onMerge?.(method);
}
</script>

<GitHubPrSection class={tone.surface} contentClass="px-3 py-2.5">
  <div class="flex items-start gap-2">
    <StatusIcon class={`mt-px size-4 shrink-0 ${tone.accent}`} />
    <div class="min-w-0 flex-1">
      <h3 class={`text-xs font-semibold ${tone.accent}`}>{title}</h3>
      {#if notes.length > 0}
        <ul class="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {#each notes as note (note)}
            <li>{note}</li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  {#if showMerge && method}
    <div class="mt-2.5">
      <SplitButton
        variant="success"
        disabled={merging || readiness.status !== "ready"}
        triggerLabel="Choose merge method"
        menuClass="w-56"
        onclick={requestMerge}
      >
        {#if merging}<Spinner class="size-3.5" />{:else}<GitMerge
            class="size-3.5"
          />{/if}
        {merging ? "Merging…" : mergeMethodLabel(method)}
        {#snippet menu()}
          {#each detail.mergeSettings.allowedMethods as option (option)}
            <DropdownMenu.Item onSelect={() => onMethodChange?.(option)}>
              <span class="w-4"
                >{#if option === method}<Check class="size-4" />{/if}</span
              >
              {mergeMethodLabel(option)}
            </DropdownMenu.Item>
          {/each}
        {/snippet}
      </SplitButton>
    </div>
  {/if}

  {#if error}
    <p class="mt-2 text-xs text-destructive" role="alert">{error}</p>
  {/if}
</GitHubPrSection>

<ConfirmDialog
  bind:open={confirmOpen}
  title={`Merge pull request #${detail.number}?`}
  description={`${method ? mergeMethodLabel(method) : "Merge"} will merge ${detail.headRefName} into ${detail.baseRefName} at head ${detail.headRefOid.slice(0, 7)}.`}
  confirmLabel="Confirm merge"
  confirmVariant="success"
  onConfirm={confirmMerge}
/>
