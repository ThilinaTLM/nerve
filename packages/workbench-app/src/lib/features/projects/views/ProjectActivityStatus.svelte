<script lang="ts">
import ListTodo from "@lucide/svelte/icons/list-todo";
import MessageCircleMore from "@lucide/svelte/icons/message-circle-more";
import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question";
import MessageCircleX from "@lucide/svelte/icons/message-circle-x";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import type { ProjectSwitcherItem } from "$lib/features/projects/state/project-switcher";

type Props = {
  item: ProjectSwitcherItem;
};

let { item }: Props = $props();

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
const hasActivity = $derived(
  item.activity.running > 0 ||
    item.activity.needsUser > 0 ||
    item.activity.failed > 0 ||
    item.tasks.running > 0,
);
</script>

<div
  class="flex min-w-0 items-center gap-1.5 text-xs tabular-nums"
  aria-label="Project activity summary"
>
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
</div>
