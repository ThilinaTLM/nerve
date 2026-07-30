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
import GithubPrSectionSkeleton from "./GithubPrSectionSkeleton.svelte";
import type { GithubPrTab, PrViewState } from "./github-pr-types";

type PrSection =
  | "core"
  | "conversation"
  | "overview"
  | "commits"
  | "checks"
  | "files";

type Props = {
  view?: PrViewState;
  onRefresh?: () => void;
  onCheckout?: () => void;
  onOpenExternal?: () => void;
  onTabChange?: (tab: GithubPrTab) => void;
  onSectionRetry?: (section: PrSection) => void;
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
  onSectionRetry,
  onFileSelect,
  onMergeMethodChange,
  onMerge,
}: Props = $props();
const core = $derived(view?.core.data);
const conversation = $derived(view?.conversation.data);
const overview = $derived(view?.overview.data);
const commits = $derived(view?.commits.data);
const checks = $derived(view?.checks.data?.checks);
const files = $derived(view?.files.data);

const tabTriggerClass =
  "h-full flex-none gap-1.5 rounded-sm px-2.5 text-xs font-medium data-active:bg-background data-active:shadow-xs data-active:ring-1 data-active:ring-border";

function changeTab(value: string) {
  if (
    value === "conversation" ||
    value === "commits" ||
    value === "checks" ||
    value === "files"
  )
    onTabChange?.(value);
}

function confirmCheckout() {
  if (!core) return;
  if (
    window.confirm(
      `Check out PR #${core.number} (${core.headRefName}) in this repo?`,
    )
  )
    onCheckout?.();
}
</script>

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
    <div class="flex h-full flex-col gap-4 px-4 py-4">
      <div class="flex items-center gap-3" role="status">
        <Spinner class="size-4" />
        <span class="text-sm font-medium"
          >Loading pull request #{view.number}</span
        >
      </div>
      <GithubPrSectionSkeleton rows={2} label="Loading pull request header" />
      <GithubPrSectionSkeleton rows={6} label="Loading pull request details" />
    </div>
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
    <GithubPrHeader
      detail={core}
      loading={view.core.refreshing}
      commitCount={commits?.commits.length}
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
            {#if conversation}<span class="text-muted-foreground"
                >{conversation.comments.length +
                  conversation.reviews.length}</span
              >{/if}
          </Tabs.Trigger>
          <Tabs.Trigger value="commits" class={tabTriggerClass}>
            Commits
            {#if commits}<span class="text-muted-foreground"
                >{commits.commits.length}</span
              >{/if}
          </Tabs.Trigger>
          <Tabs.Trigger value="checks" class={tabTriggerClass}>
            Checks
            {#if checks}<span class="text-muted-foreground">{checks.total}</span
              >{/if}
          </Tabs.Trigger>
          <Tabs.Trigger value="files" class={tabTriggerClass}>
            Files changed <span class="text-muted-foreground"
              >{core.changedFiles}</span
            >
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
              <GithubPrConversation {core} {conversation} />
            {:else if view.conversation.error}
              {@render sectionError(view.conversation.error, "conversation")}
            {:else}
              <GithubPrSectionSkeleton rows={7} label="Loading conversation" />
            {/if}
            <aside class="flex flex-col gap-2">
              {#if overview}
                <GithubPrOverview {overview} />
              {:else if view.overview.error}
                {@render sectionError(view.overview.error, "overview")}
              {:else}
                <GithubPrSectionSkeleton rows={4} label="Loading overview" />
              {/if}
              {#if overview && checks}
                <GithubPrMergeBox
                  detail={{ ...core, ...overview, checks }}
                  selectedMethod={view.selectedMergeMethod}
                  merging={view.merging}
                  error={view.mergeError}
                  onMethodChange={onMergeMethodChange}
                  {onMerge}
                />
              {:else}
                <GithubPrSectionSkeleton
                  rows={3}
                  label="Loading merge status"
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
            <GithubPrCommits response={commits} />
          {:else if view.commits.error}
            {@render sectionError(view.commits.error, "commits")}
          {:else}
            <GithubPrSectionSkeleton rows={6} label="Loading commits" />
          {/if}
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="checks" class="min-h-0 flex-1">
        <ScrollArea
          class="h-full"
          viewportClass="@container px-4 pr-2 pt-1 pb-8"
        >
          {#if checks}
            <GithubPrChecks {checks} />
          {:else if view.checks.error}
            {@render sectionError(view.checks.error, "checks")}
          {:else}
            <GithubPrSectionSkeleton rows={6} label="Loading checks" />
          {/if}
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="files" class="min-h-0 flex-1">
        <GithubPrFiles
          detail={core}
          {files}
          loading={view.files.loading}
          error={view.files.error}
          selectedPath={view.selectedFilePath}
          onRetry={() => onSectionRetry?.("files")}
          onSelect={onFileSelect}
        />
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</section>
