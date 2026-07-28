<script lang="ts">
import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
import Files from "@lucide/svelte/icons/files";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import MessageSquare from "@lucide/svelte/icons/message-square";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { GithubPrMergeMethod } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import GithubPrChecks from "./GithubPrChecks.svelte";
import GithubPrCommits from "./GithubPrCommits.svelte";
import GithubPrConversation from "./GithubPrConversation.svelte";
import GithubPrFiles from "./GithubPrFiles.svelte";
import GithubPrHeader from "./GithubPrHeader.svelte";
import GithubPrMergeBox from "./GithubPrMergeBox.svelte";
import GithubPrOverview from "./GithubPrOverview.svelte";
import type { GithubPrTab, PrViewState } from "./github-pr-types";

type Props = {
  view?: PrViewState;
  onRefresh?: () => void;
  onCheckout?: () => void;
  onOpenExternal?: () => void;
  onTabChange?: (tab: GithubPrTab) => void;
  onFilesRetry?: () => void;
  onFileSelect?: (path: string) => void;
  onMergeMethodChange?: (method: GithubPrMergeMethod) => void;
  onMerge?: (method: GithubPrMergeMethod) => void;
};

let {
  view,
  onRefresh,
  onCheckout,
  onOpenExternal,
  onTabChange,
  onFilesRetry,
  onFileSelect,
  onMergeMethodChange,
  onMerge,
}: Props = $props();
const detail = $derived(view?.detail);

function changeTab(value: string) {
  if (
    value === "conversation" ||
    value === "commits" ||
    value === "checks" ||
    value === "files"
  ) {
    onTabChange?.(value);
  }
}

function confirmCheckout() {
  if (!detail) return;
  if (
    window.confirm(
      `Check out PR #${detail.number} (${detail.headRefName}) in this repo?`,
    )
  ) {
    onCheckout?.();
  }
}
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
  {#if !view}
    <div
      class="grid min-h-80 flex-1 place-items-center text-center text-muted-foreground"
    >
      <div>
        <GitPullRequest class="mx-auto size-8 text-primary" />
        <strong class="mt-3 block text-foreground"
          >No pull request selected</strong
        >
        <p class="mt-1 text-sm">
          Open a PR from the Git panel to view its details here.
        </p>
      </div>
    </div>
  {:else if view.loading && !detail}
    <div
      class="grid min-h-80 flex-1 place-items-center text-center text-muted-foreground"
    >
      <div>
        <Spinner class="mx-auto size-7" /><strong
          class="mt-3 block text-foreground">Loading pull request</strong
        >
        <p class="mt-1 text-sm">#{view.number}</p>
      </div>
    </div>
  {:else if view.error && !detail}
    <div class="grid min-h-80 flex-1 place-items-center text-center">
      <div class="max-w-md">
        <TriangleAlert class="mx-auto size-8 text-destructive" />
        <strong class="mt-3 block">Could not open pull request</strong>
        <p class="mt-1 text-sm text-destructive">{view.error}</p>
        <Button
          class="mt-3"
          size="sm"
          variant="outline"
          onclick={() => onRefresh?.()}
        >
          <RotateCcw class="size-4" /> Retry
        </Button>
      </div>
    </div>
  {:else if detail}
    <GithubPrHeader
      {detail}
      loading={view.loading}
      {onRefresh}
      onCheckout={confirmCheckout}
      {onOpenExternal}
    />

    <Tabs.Root
      value={view.activeTab}
      onValueChange={changeTab}
      class="min-h-0 flex-1 gap-0"
    >
      <Tabs.List
        variant="line"
        class="w-full shrink-0 justify-start border-b px-5"
      >
        <Tabs.Trigger value="conversation">
          <MessageSquare class="size-4" /> Conversation
          <span class="text-muted-foreground"
            >{detail.comments.length + detail.reviews.length}</span
          >
        </Tabs.Trigger>
        <Tabs.Trigger value="commits">
          <GitCommitHorizontal class="size-4" /> Commits
          <span class="text-muted-foreground">{detail.commits.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="checks">
          <CheckCircle2 class="size-4" /> Checks
          <span class="text-muted-foreground">{detail.checks.total}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="files">
          <Files class="size-4" /> Files changed
          <span class="text-muted-foreground">{detail.changedFiles}</span>
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="conversation" class="min-h-0 flex-1">
        <ScrollArea class="h-full" viewportClass="@container p-5 pb-12">
          <div
            class="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]"
          >
            <GithubPrConversation {detail} />
            <aside class="space-y-4">
              <GithubPrOverview {detail} />
              <GithubPrMergeBox
                {detail}
                selectedMethod={view.selectedMergeMethod}
                merging={view.merging}
                error={view.mergeError}
                onMethodChange={onMergeMethodChange}
                {onMerge}
              />
            </aside>
          </div>
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="commits" class="min-h-0 flex-1">
        <ScrollArea class="h-full" viewportClass="p-5 pb-12">
          <GithubPrCommits {detail} />
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="checks" class="min-h-0 flex-1">
        <ScrollArea class="h-full" viewportClass="p-5 pb-12">
          <GithubPrChecks {detail} />
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="files" class="min-h-0 flex-1">
        <GithubPrFiles
          {detail}
          files={view.files}
          loading={view.filesLoading}
          error={view.filesError}
          selectedPath={view.selectedFilePath}
          onRetry={onFilesRetry}
          onSelect={onFileSelect}
        />
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</section>
