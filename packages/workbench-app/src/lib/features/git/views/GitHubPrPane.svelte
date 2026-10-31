<script lang="ts">
import CircleX from "@lucide/svelte/icons/circle-x";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type {
  GithubPrFileDiffResponse,
  GithubPrMergeMethod,
} from "@nervekit/contracts/git";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import {
  linkedPullRequestConversations,
  pullRequestResourceKey,
} from "$lib/presentation/conversations/conversation-references";
import { conversationLastUserPromptAt } from "@nervekit/contracts/core";
import { idleConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import PrActions from "./pr/PrActions.svelte";
import PrChecksTab from "./pr/PrChecksTab.svelte";
import PrCommitsTab from "./pr/PrCommitsTab.svelte";
import PrConversationTab from "./pr/PrConversationTab.svelte";
import PrFilesTab from "./pr/PrFilesTab.svelte";
import PrHeader from "./pr/PrHeader.svelte";
import PrSkeleton from "./pr/PrSkeleton.svelte";
import type {
  GithubPrTab,
  PrLinkedConversation,
  PrMergeFollowUp,
  PrSectionState,
  PrViewState,
} from "./github-pr-types";
import { prReviewers } from "./pr-pane-helpers";
import { summarizeCheckRuns } from "./github-pr-checks";

type PrSection =
  | "core"
  | "conversation"
  | "overview"
  | "commits"
  | "checks"
  | "files";

type Props = {
  view?: PrViewState;
  /** Current branch of the repository the PR belongs to. */
  currentBranch?: string;
  onRefresh?: () => void;
  onCheckout?: () => void;
  onCopyLink?: () => void;
  onOpenExternal?: () => void;
  onTabChange?: (tab: GithubPrTab) => void;
  onSectionRetry?: (section: PrSection) => void;
  fileDiff?: PrSectionState<GithubPrFileDiffResponse>;
  onFileSelect?: (path: string) => void;
  onFileDiffRetry?: () => void;
  onMergeMethodChange?: (method: GithubPrMergeMethod) => void;
  onMerge?: (method: GithubPrMergeMethod, followUp: PrMergeFollowUp) => void;
};

let {
  view,
  currentBranch,
  onRefresh,
  onCheckout,
  onCopyLink,
  onOpenExternal,
  onTabChange,
  onSectionRetry,
  fileDiff,
  onFileSelect,
  onFileDiffRetry,
  onMergeMethodChange,
  onMerge,
}: Props = $props();
const core = $derived(view?.core.data);
const conversation = $derived(view?.conversation.data);
const overview = $derived(view?.overview.data);
const commits = $derived(view?.commits.data);
const checks = $derived(view?.checks.data?.checks);
const files = $derived(view?.files.data);
const checkedOut = $derived(
  Boolean(currentBranch) && core?.headRefName === currentBranch,
);
const checkSummary = $derived(
  checks ? summarizeCheckRuns(checks.runs) : undefined,
);
const checksWaiting = $derived(
  (checkSummary?.counts.running ?? 0) + (checkSummary?.counts.queued ?? 0) > 0,
);
const reviewers = $derived(prReviewers(conversation, overview, core?.author));
const linked = $derived.by<PrLinkedConversation[]>(() => {
  const key = core ? pullRequestResourceKey(core.url) : undefined;
  return linkedPullRequestConversations(
    workspaceSelectors.conversations,
    key,
  ).map(({ row, relationship }) => ({
    id: row.id,
    title: row.title,
    relationship,
    at: conversationLastUserPromptAt(row),
    activity:
      workspaceSelectors.conversationActivityById[row.id] ??
      idleConversationActivity,
  }));
});
let checkoutOpen = $state(false);

function changeTab(value: string) {
  if (
    value === "conversation" ||
    value === "commits" ||
    value === "checks" ||
    value === "files"
  )
    onTabChange?.(value);
}
</script>

{#snippet tabCount(count: number)}
  <span class="text-muted-foreground tabular-nums">{count}</span>
{/snippet}

<!-- Failure details live in header Activity; this is a neutral retry state. -->
{#snippet sectionUnavailable(label: string, section: PrSection)}
  <div class="flex flex-col items-start gap-2 px-4 py-4 text-xs">
    <span class="text-muted-foreground">{label} unavailable</span>
    <Button
      size="sm"
      variant="outline"
      onclick={() => onSectionRetry?.(section)}
    >
      <RotateCcw class="size-3" /> Retry
    </Button>
  </div>
{/snippet}

<section
  class="@container flex h-full min-h-0 flex-col bg-background"
  aria-label="Pull request"
>
  {#if !view}
    <Empty.Root class="h-full min-h-0 gap-2 py-6">
      <Empty.Media variant="icon" class="size-8 rounded-md">
        <GitPullRequest class="size-4" aria-hidden="true" />
      </Empty.Media>
      <Empty.Header class="gap-1">
        <Empty.Title class="text-sm font-medium"
          >No pull request selected</Empty.Title
        >
        <Empty.Description class="text-xs">
          Open a PR from the Git panel to view its details here.
        </Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else if view.core.loading && !core}
    <PrHeader
      number={view.number}
      summary={view.summary}
      refreshing
      checkedOut={false}
      {onRefresh}
      {onCopyLink}
      {onOpenExternal}
    />
    <PrSkeleton label="Loading pull request" rows={6} />
  {:else if view.core.error && !core}
    <Empty.Root class="h-full min-h-0 gap-2 py-6">
      <Empty.Media variant="icon" class="size-8 rounded-md">
        <TriangleAlert
          class="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </Empty.Media>
      <Empty.Header class="gap-1">
        <Empty.Title class="text-sm font-medium"
          >Pull request unavailable</Empty.Title
        >
        <Empty.Description class="text-xs">
          Details are in Activity. Retry to load it again.
        </Empty.Description>
      </Empty.Header>
      <Button
        size="sm"
        variant="outline"
        onclick={() => onSectionRetry?.("core")}
      >
        <RotateCcw class="size-3" /> Retry
      </Button>
    </Empty.Root>
  {:else if core}
    <PrHeader
      number={view.number}
      {core}
      summary={view.summary}
      refreshing={view.refreshing}
      {checkedOut}
      {onRefresh}
      {onCopyLink}
      {onOpenExternal}
    >
      {#snippet actions()}
        <PrActions
          {core}
          {overview}
          {checks}
          selectedMethod={view.selectedMergeMethod}
          merging={view.merging}
          {checkedOut}
          onMethodChange={onMergeMethodChange}
          {onMerge}
          onCheckout={() => (checkoutOpen = true)}
          onReady={onOpenExternal}
        />
      {/snippet}
    </PrHeader>

    <Tabs.Root
      value={view.activeTab}
      onValueChange={changeTab}
      class="min-h-0 flex-1"
    >
      <Tabs.List>
        <Tabs.Trigger value="conversation">
          Conversation
          {#if conversation}{@render tabCount(
              conversation.comments.length + conversation.reviews.length,
            )}{/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="commits">
          Commits
          {#if commits}{@render tabCount(commits.commits.length)}{/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="checks">
          Checks
          {#if checks}{@render tabCount(checks.total)}{/if}
          {#if checksWaiting}
            <Spinner class="size-3 text-warning" />
          {:else if (checkSummary?.counts.failed ?? 0) > 0}
            <CircleX class="size-3 text-destructive" aria-hidden="true" />
          {/if}
        </Tabs.Trigger>
        <Tabs.Trigger value="files">
          Files changed {@render tabCount(core.changedFiles)}
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="conversation" class="min-h-0 flex-1">
        {#if conversation}
          <PrConversationTab
            {core}
            {conversation}
            {reviewers}
            labels={overview?.labels ?? []}
            {linked}
            onOpenConversation={(id) => void openConversation(id)}
          />
        {:else if view.conversation.error}
          {@render sectionUnavailable("Conversation", "conversation")}
        {:else}
          <PrSkeleton label="Loading conversation" />
        {/if}
      </Tabs.Content>

      <Tabs.Content value="commits" class="min-h-0 flex-1">
        {#if commits}
          <PrCommitsTab response={commits} />
        {:else if view.commits.error}
          {@render sectionUnavailable("Commits", "commits")}
        {:else}
          <PrSkeleton label="Loading commits" rows={6} />
        {/if}
      </Tabs.Content>

      <Tabs.Content value="checks" class="min-h-0 flex-1">
        {#if checks}
          <PrChecksTab {checks} />
        {:else if view.checks.error}
          {@render sectionUnavailable("Checks", "checks")}
        {:else}
          <PrSkeleton label="Loading checks" rows={6} />
        {/if}
      </Tabs.Content>

      <Tabs.Content value="files" class="min-h-0 flex-1">
        <PrFilesTab
          {files}
          loading={view.files.loading}
          failed={Boolean(view.files.error)}
          selectedPath={view.selectedFilePath}
          {fileDiff}
          onRetry={() => onSectionRetry?.("files")}
          onSelect={onFileSelect}
          {onFileDiffRetry}
        />
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</section>

<ConfirmDialog
  bind:open={checkoutOpen}
  title={`Check out PR #${view?.number ?? ""}?`}
  description={core
    ? `This switches the repository to ${core.headRefName}. Uncommitted changes stay in the working tree.`
    : ""}
  confirmLabel="Check out branch"
  onConfirm={() => {
    checkoutOpen = false;
    onCheckout?.();
  }}
/>
