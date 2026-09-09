<script lang="ts">
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import GitHubPrHeader from "./GitHubPrHeader.svelte";
import GitHubPrSectionSkeleton from "./GitHubPrSectionSkeleton.svelte";
import type { PrViewState } from "./github-pr-types";

type Props = {
  view: PrViewState;
  onRefresh?: () => void;
  onOpenExternal?: () => void;
};
let { view, onRefresh, onOpenExternal }: Props = $props();
const tabTriggerClass =
  "h-full flex-none gap-1.5 rounded-none px-2.5 text-xs font-medium";
</script>

<GitHubPrHeader
  number={view.number}
  summary={view.summary}
  loading={view.core.loading || view.refreshing}
  {onRefresh}
  {onOpenExternal}
/>
<Tabs.Root value="conversation" class="min-h-0 flex-1 gap-0">
  <div class="shrink-0 border-b px-4">
    <Tabs.List variant="line" class="h-9 gap-0 p-0">
      <Tabs.Trigger value="conversation" class={tabTriggerClass}
        >Conversation</Tabs.Trigger
      >
      <Tabs.Trigger value="commits" class={tabTriggerClass}
        >Commits</Tabs.Trigger
      >
      <Tabs.Trigger value="checks" class={tabTriggerClass}>Checks</Tabs.Trigger>
      <Tabs.Trigger value="files" class={tabTriggerClass}
        >Files changed</Tabs.Trigger
      >
    </Tabs.List>
  </div>
  <Tabs.Content value="conversation" class="min-h-0 flex-1">
    <ScrollArea class="h-full" viewportClass="@container px-4 pr-2 pt-1 pb-8">
      <div
        class="grid items-start gap-2 @3xl:grid-cols-[minmax(0,1fr)_18rem] @6xl:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <GitHubPrSectionSkeleton
          variant="conversation"
          label="Loading pull request conversation"
        />
        <aside class="flex flex-col gap-2">
          <GitHubPrSectionSkeleton
            variant="overview"
            label="Loading pull request overview"
          />
          <GitHubPrSectionSkeleton
            variant="merge"
            label="Loading pull request merge status"
          />
        </aside>
      </div>
    </ScrollArea>
  </Tabs.Content>
</Tabs.Root>
