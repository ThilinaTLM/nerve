<script lang="ts">
import Activity from "@lucide/svelte/icons/activity";
import Logs from "@lucide/svelte/icons/logs";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  cancelSelectedTask,
  restartSelectedTask,
  taskSelectors,
} from "$lib/features/tasks";
import { workspaceSelectors } from "$lib/application/workspace";
import MobileRootActions from "./MobileRootActions.svelte";
import MobileStatusStrip from "./MobileStatusStrip.svelte";
import { buildMobileActivity } from "./mobile-activity";
import {
  openMobileConversation,
  openMobileTaskOutput,
} from "./mobile-route-activation.svelte";
import { pushMobileScreen } from "./mobile-shell.svelte";

/**
 * What is moving right now, across every project: live conversations, live
 * background tasks, daemon health, and the application log.
 */
const model = $derived(
  buildMobileActivity({
    conversations: workspaceSelectors.conversations,
    activityById: workspaceSelectors.conversationActivityById,
    tasks: taskSelectors.tasks,
    projects: workspaceSelectors.projects,
  }),
);
const logsEnabled = $derived(
  workspaceSelectors.status?.capabilities.applicationLogs ?? false,
);
const subtitle = $derived.by(() => {
  const parts: string[] = [];
  if (model.conversations.length)
    parts.push(
      `${model.conversations.length} ${model.conversations.length === 1 ? "chat" : "chats"}`,
    );
  if (model.tasks.length)
    parts.push(
      `${model.tasks.length} ${model.tasks.length === 1 ? "task" : "tasks"}`,
    );
  return parts.length ? parts.join(" · ") : "Nothing running";
});

function meta(projectLabel: string | undefined, at: string): string {
  return [projectLabel, relativeTimeLabel(at)].filter(Boolean).join(" · ");
}

function taskMenu(taskId: string): ContextMenuItem[] {
  return [
    {
      label: "Show output",
      icon: Terminal,
      onSelect: () => openMobileTaskOutput(taskId),
    },
    {
      label: "Restart",
      icon: RotateCcw,
      onSelect: () => void restartSelectedTask(taskId),
    },
    {
      label: "Stop",
      icon: Square,
      destructive: true,
      onSelect: () => void cancelSelectedTask(taskId),
    },
  ];
}
</script>

<MobileScreen title="Activity" {subtitle}>
  {#snippet actions()}
    <MobileRootActions />
  {/snippet}

  <MobileStatusStrip />

  {#if model.conversations.length}
    <MobileSection title="Conversations" meta={`${model.conversations.length}`}>
      {#each model.conversations as row (row.conversationId)}
        <MobileListRow
          title={row.title}
          detail={row.detail}
          meta={meta(row.projectLabel, row.at)}
          tone={row.tone}
          pulse={row.pulse}
          onclick={() => void openMobileConversation(row.conversationId)}
        />
      {/each}
    </MobileSection>
  {/if}

  {#if model.tasks.length}
    <MobileSection title="Tasks" meta={`${model.tasks.length}`}>
      {#each model.tasks as row (row.taskId)}
        <MobileListRow
          title={row.title}
          detail={row.detail}
          meta={meta(row.projectLabel, row.at)}
          tone={row.tone}
          pulse={row.pulse}
          menuItems={taskMenu(row.taskId)}
          onclick={() => openMobileTaskOutput(row.taskId)}
        />
      {/each}
    </MobileSection>
  {/if}

  {#if !model.conversations.length && !model.tasks.length}
    <Empty.Root class="px-6 py-10">
      <Empty.Header>
        <Empty.Media class="text-muted-foreground">
          <Activity size={28} strokeWidth={1.6} />
        </Empty.Media>
        <Empty.Title class="text-sm">Nothing running</Empty.Title>
        <Empty.Description class="text-xs">
          Running agents and background tasks from every project show up here.
        </Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}

  {#if logsEnabled}
    <MobileSection title="Daemon">
      <MobileListRow
        title="Logs"
        detail="Daemon and application logs"
        icon={Logs}
        onclick={() => pushMobileScreen({ kind: "logs" })}
      />
    </MobileSection>
  {/if}
</MobileScreen>
