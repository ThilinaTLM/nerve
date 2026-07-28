<script lang="ts">
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { GithubPrMergeMethod } from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
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

const tabTriggerClass =
  "h-full flex-none gap-1.5 rounded-sm px-2.5 text-xs font-medium data-active:bg-background data-active:shadow-xs data-active:ring-1 data-active:ring-border";

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
  {:else if view.loading && !detail}
    <Empty.Root class="h-full min-h-0 gap-2 py-6">
      <Empty.Media variant="icon" class="size-8 rounded-md">
        <Spinner class="size-4" />
      </Empty.Media>
      <Empty.Header class="gap-1">
        <Empty.Title class="text-sm font-medium"
          >Loading pull request</Empty.Title
        >
        <Empty.Description class="text-xs">#{view.number}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {:else if view.error && !detail}
    <Empty.Root class="h-full min-h-0 gap-2 py-6">
      <Empty.Media variant="icon" class="size-8 rounded-md">
        <TriangleAlert class="size-4 text-destructive" aria-hidden="true" />
      </Empty.Media>
      <Empty.Header class="gap-1">
        <Empty.Title class="text-sm font-medium"
          >Could not open pull request</Empty.Title
        >
        <Empty.Description class="text-xs text-destructive"
          >{view.error}</Empty.Description
        >
      </Empty.Header>
      <Empty.Content class="gap-1">
        <Button size="xs" variant="outline" onclick={() => onRefresh?.()}>
          <RotateCcw class="size-3" /> Retry
        </Button>
      </Empty.Content>
    </Empty.Root>
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
      <div class="shrink-0 px-4 pt-3 pb-2">
        <Tabs.List
          class="h-8 gap-1 rounded-md bg-accent/35 p-1 ring-1 ring-border ring-inset"
        >
          <Tabs.Trigger value="conversation" class={tabTriggerClass}>
            Conversation
            <span class="text-muted-foreground"
              >{detail.comments.length + detail.reviews.length}</span
            >
          </Tabs.Trigger>
          <Tabs.Trigger value="commits" class={tabTriggerClass}>
            Commits
            <span class="text-muted-foreground">{detail.commits.length}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="checks" class={tabTriggerClass}>
            Checks
            <span class="text-muted-foreground">{detail.checks.total}</span>
          </Tabs.Trigger>
          <Tabs.Trigger value="files" class={tabTriggerClass}>
            Files changed
            <span class="text-muted-foreground">{detail.changedFiles}</span>
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
            <GithubPrConversation {detail} />
            <aside class="flex flex-col gap-2">
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
        <ScrollArea
          class="h-full"
          viewportClass="@container px-4 pr-2 pt-1 pb-8"
        >
          <GithubPrCommits {detail} />
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="checks" class="min-h-0 flex-1">
        <ScrollArea
          class="h-full"
          viewportClass="@container px-4 pr-2 pt-1 pb-8"
        >
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
