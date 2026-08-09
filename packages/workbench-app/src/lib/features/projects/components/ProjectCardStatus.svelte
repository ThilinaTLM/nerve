<script lang="ts">
import GitBranch from "@lucide/svelte/icons/git-branch";
import ListTodo from "@lucide/svelte/icons/list-todo";
import MessageCircleMore from "@lucide/svelte/icons/message-circle-more";
import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question";
import MessageCircleX from "@lucide/svelte/icons/message-circle-x";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import type { ProjectGitOverview } from "$lib/features/projects/state/project-overview";
import type { ProjectSwitcherItem } from "$lib/features/projects/state/project-switcher";

type Props = {
  item: ProjectSwitcherItem;
  git?: ProjectGitOverview;
  gitLoading?: boolean;
  gitError?: boolean;
};

let { item, git, gitLoading = false, gitError = false }: Props = $props();

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const runningLabel = $derived(
  `${countLabel(item.activity.running, "conversation")} running`,
);
const waitingLabel = $derived(
  `${countLabel(item.activity.needsUser, "conversation")} waiting for you`,
);
const failedLabel = $derived(
  `${countLabel(item.activity.failed, "conversation")} failed`,
);
const taskLabel = $derived(
  `${countLabel(item.tasks.running, "background task")} running`,
);
const gitLabel = $derived.by(() => {
  if (gitLoading && !git) return "Loading Git status";
  if (gitError) return "Git status unavailable";
  if (!git || git.repositoryCount === 0) return "No Git repository";

  const repository =
    git.repositoryCount > 1
      ? `${git.repositoryCount} repositories`
      : git.detached
        ? "Detached HEAD"
        : (git.branch ?? "Unknown branch");
  const workingTree = git.changeCount
    ? countLabel(git.changeCount, "working tree change")
    : "Clean working tree";
  const unpublished = git.aheadCount
    ? countLabel(git.aheadCount, "unpublished commit")
    : git.upstreamKnown
      ? "No unpublished commits"
      : "Unpublished commits unknown";
  return `${repository}. ${workingTree}. ${unpublished}.`;
});
const gitValue = $derived(
  gitError || !git || git.repositoryCount === 0 ? "—" : git.changeCount,
);
const hasActivity = $derived(
  item.activity.running > 0 ||
    item.activity.needsUser > 0 ||
    item.activity.failed > 0 ||
    item.tasks.running > 0,
);
</script>

<div
  class="flex min-w-0 items-center justify-between gap-3 text-xs tabular-nums"
  aria-label="Project status summary"
>
  <span class="flex min-w-0 items-center gap-1.5">
    {#if item.activity.needsUser}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="inline-flex cursor-help items-center gap-1 rounded-sm border-0 bg-warning/10 px-1.5 py-0.5 text-warning"
              aria-label={waitingLabel}
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
            >
              <MessageCircleQuestion class="size-3.5" aria-hidden="true" />
              <span>{item.activity.needsUser}</span>
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content sideOffset={5}>{waitingLabel}</Tooltip.Content>
      </Tooltip.Root>
    {/if}

    {#if item.activity.failed}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="inline-flex cursor-help items-center gap-1 rounded-sm border-0 bg-destructive/10 px-1.5 py-0.5 text-destructive"
              aria-label={failedLabel}
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
            >
              <MessageCircleX class="size-3.5" aria-hidden="true" />
              <span>{item.activity.failed}</span>
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content sideOffset={5}>{failedLabel}</Tooltip.Content>
      </Tooltip.Root>
    {/if}

    {#if item.activity.running}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="inline-flex cursor-help items-center gap-1 rounded-sm border-0 bg-info/10 px-1.5 py-0.5 text-info"
              aria-label={runningLabel}
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
            >
              <MessageCircleMore class="size-3.5" aria-hidden="true" />
              <span>{item.activity.running}</span>
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content sideOffset={5}>{runningLabel}</Tooltip.Content>
      </Tooltip.Root>
    {/if}

    {#if item.tasks.running}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="inline-flex cursor-help items-center gap-1 rounded-sm border-0 bg-info/10 px-1.5 py-0.5 text-info"
              aria-label={taskLabel}
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
            >
              <ListTodo class="size-3.5" aria-hidden="true" />
              <span>{item.tasks.running}</span>
            </button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content sideOffset={5}>{taskLabel}</Tooltip.Content>
      </Tooltip.Root>
    {/if}

    {#if !hasActivity}
      <span class="text-muted-foreground">No active work</span>
    {/if}
  </span>

  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class={`inline-flex flex-none cursor-help items-center gap-1 rounded-sm border-0 px-1.5 py-0.5 ${git && git.repositoryCount > 0 ? (git.changeCount ? "bg-warning/10 text-warning" : "bg-success/10 text-success") : "bg-transparent text-muted-foreground"}`}
          aria-label={gitLabel}
          onclick={(event) => event.stopPropagation()}
          onkeydown={(event) => event.stopPropagation()}
        >
          <GitBranch class="size-3.5" aria-hidden="true" />
          {#if gitLoading && !git}
            <Skeleton class="h-3 w-4" aria-label="Loading Git status" />
          {:else}
            <span>{gitValue}</span>
          {/if}
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content sideOffset={5} class="max-w-72">
      {gitLabel}
    </Tooltip.Content>
  </Tooltip.Root>
</div>
