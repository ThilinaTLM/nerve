<script lang="ts">
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
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import GitHubPrChecks from "./GitHubPrChecks.svelte";
import GitHubPrCommits from "./GitHubPrCommits.svelte";
import GitHubPrConversation from "./GitHubPrConversation.svelte";
import GitHubPrFiles from "./GitHubPrFiles.svelte";
import GitHubPrHeader from "./GitHubPrHeader.svelte";
import GitHubPrLoadingPane from "./GitHubPrLoadingPane.svelte";
import GitHubPrOverview from "./GitHubPrOverview.svelte";
import GitHubPrStatusCard from "./GitHubPrStatusCard.svelte";
import GitHubPrSectionSkeleton from "./GitHubPrSectionSkeleton.svelte";
import type {
  GithubPrTab,
  PrSectionState,
  PrViewState,
} from "./github-pr-types";

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
  onMerge?: (method: GithubPrMergeMethod) => void;
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
let checkoutOpen = $state(false);

/* Tabs match the rest of the workbench: an underline strip, not a pill group. */
const tabTriggerClass = "h-full flex-none gap-1.5 px-0 text-xs font-medium";

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
  <span
    class="rounded-full bg-muted px-1.5 text-[0.6875rem] text-muted-foreground tabular-nums"
    >{count}</span
  >
{/snippet}

{#snippet sectionError(error: string, section: PrSection)}
  <div
    class="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-xs"
    role="alert"
  >
    <span class="text-destructive">{error}</span>
    <Button
      size="xs"
      variant="outline"
      onclick={() => onSectionRetry?.(section)}
    >
      <RotateCcw class="size-3" /> Retry
    </Button>
  </div>
{/snippet}

<section class="flex h-full min-h-0 flex-col bg-background">
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
    <GitHubPrLoadingPane {view} {onRefresh} {onOpenExternal} />
  {:else if view.core.error && !core}
    <Empty.Root class="h-full min-h-0 gap-2 py-6">
      <Empty.Media variant="icon" class="size-8 rounded-md">
        <TriangleAlert class="size-4 text-destructive" aria-hidden="true" />
      </Empty.Media>
      <Empty.Header class="gap-1">
        <Empty.Title class="text-sm font-medium"
          >Could not open pull request</Empty.Title
        >
        <Empty.Description class="text-xs text-destructive">
          {view.core.error}
        </Empty.Description>
      </Empty.Header>
      <Button
        size="xs"
        variant="outline"
        onclick={() => onSectionRetry?.("core")}
      >
        <RotateCcw class="size-3" /> Retry
      </Button>
    </Empty.Root>
  {:else if core}
    <GitHubPrHeader
      number={view.number}
      detail={core}
      summary={view.summary}
      loading={view.refreshing}
      commitCount={commits?.commits.length}
      {checkedOut}
      {onRefresh}
      onCheckout={() => (checkoutOpen = true)}
      {onCopyLink}
      {onOpenExternal}
    />

    {#if view.refreshError}
      <div
        class="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-1.5 text-xs text-destructive"
        role="alert"
      >
        <span class="min-w-0 flex-1 truncate"
          >Could not fully refresh: {view.refreshError}</span
        >
        <Button size="xs" variant="ghost" onclick={() => onRefresh?.()}>
          <RotateCcw class="size-3" /> Retry
        </Button>
      </div>
    {/if}

    <Tabs.Root
      value={view.activeTab}
      onValueChange={changeTab}
      class="min-h-0 flex-1 gap-0"
    >
      <div class="shrink-0 border-b px-4">
        <Tabs.List variant="line" class="h-9 gap-3 p-0">
          <Tabs.Trigger value="conversation" class={tabTriggerClass}>
            Conversation
            {#if conversation}{@render tabCount(
                conversation.comments.length + conversation.reviews.length,
              )}{/if}
          </Tabs.Trigger>
          <Tabs.Trigger value="commits" class={tabTriggerClass}>
            Commits
            {#if commits}{@render tabCount(commits.commits.length)}{/if}
          </Tabs.Trigger>
          <Tabs.Trigger value="checks" class={tabTriggerClass}>
            Checks
            {#if checks}{@render tabCount(checks.total)}{/if}
          </Tabs.Trigger>
          <Tabs.Trigger value="files" class={tabTriggerClass}>
            Files changed {@render tabCount(core.changedFiles)}
          </Tabs.Trigger>
        </Tabs.List>
      </div>

      <Tabs.Content value="conversation" class="min-h-0 flex-1">
        <ScrollArea
          class="h-full"
          viewportClass="@container px-4 pr-2 pt-1 pb-8"
        >
          <div
            class="grid items-start gap-2 @3xl:grid-cols-[minmax(0,1fr)_18rem] @6xl:grid-cols-[minmax(0,1fr)_22rem]"
          >
            {#if conversation}
              <GitHubPrConversation {core} {conversation} />
            {:else if view.conversation.error}
              {@render sectionError(view.conversation.error, "conversation")}
            {:else}
              <GitHubPrSectionSkeleton
                variant="conversation"
                label="Loading conversation"
              />
            {/if}
            <!-- Outcome first: what to do about this PR outranks its metadata. -->
            <aside class="flex flex-col gap-2">
              {#if overview && checks}
                <GitHubPrStatusCard
                  detail={{ ...core, ...overview, checks }}
                  selectedMethod={view.selectedMergeMethod}
                  merging={view.merging}
                  error={view.mergeError}
                  onMethodChange={onMergeMethodChange}
                  {onMerge}
                />
              {:else}
                <GitHubPrSectionSkeleton
                  variant="merge"
                  label="Loading merge status"
                />
              {/if}
              {#if overview}
                <GitHubPrOverview {overview} open={core.state === "OPEN"} />
              {:else if view.overview.error}
                {@render sectionError(view.overview.error, "overview")}
              {:else}
                <GitHubPrSectionSkeleton
                  variant="overview"
                  label="Loading overview"
                />
              {/if}
            </aside>
          </div>
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="commits" class="min-h-0 flex-1">
        <ScrollArea
          class="h-full"
          viewportClass="@container px-4 pr-2 pt-1 pb-8"
        >
          {#if commits}
            <GitHubPrCommits response={commits} />
          {:else if view.commits.error}
            {@render sectionError(view.commits.error, "commits")}
          {:else}
            <GitHubPrSectionSkeleton
              variant="commits"
              rows={6}
              label="Loading commits"
            />
          {/if}
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="checks" class="min-h-0 flex-1">
        <ScrollArea
          class="h-full"
          viewportClass="@container px-4 pr-2 pt-1 pb-8"
        >
          {#if checks}
            <GitHubPrChecks {checks} />
          {:else if view.checks.error}
            {@render sectionError(view.checks.error, "checks")}
          {:else}
            <GitHubPrSectionSkeleton
              variant="checks"
              rows={6}
              label="Loading checks"
            />
          {/if}
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="files" class="min-h-0 flex-1">
        <GitHubPrFiles
          detail={core}
          {files}
          loading={view.files.loading}
          error={view.files.error}
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
