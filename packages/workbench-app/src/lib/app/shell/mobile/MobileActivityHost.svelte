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
  cancelSelectedLaunch,
  restartSelectedLaunch,
  launchSelectors,
} from "$lib/features/launches";
import { workspaceSelectors } from "$lib/application/workspace";
import MobileNewChatFab from "./MobileNewChatFab.svelte";
import MobileRootActions from "./MobileRootActions.svelte";
import MobileStatusStrip from "./MobileStatusStrip.svelte";
import { activitySupportingLine, buildMobileActivity } from "./mobile-activity";
import { mobileConversationRowActions } from "./mobile-conversation-swipe.svelte";
import {
  mobileConnectionText,
  mobileStatusSheet,
} from "./mobile-status.svelte";
import {
  openMobileConversation,
  openMobileLaunchOutput,
} from "./mobile-route-activation.svelte";
import { pushMobileScreen } from "./mobile-shell.svelte";

/**
 * What is moving right now, across every project: live conversations, live
 * background launches, daemon health, and the application log.
 */
const model = $derived(
  buildMobileActivity({
    conversations: workspaceSelectors.conversations,
    activityById: workspaceSelectors.conversationActivityById,
    launches: launchSelectors.launches,
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
  if (model.launches.length)
    parts.push(
      `${model.launches.length} ${model.launches.length === 1 ? "launch" : "launches"}`,
    );
  if (!parts.length) parts.push("Nothing running");
  parts.push(mobileConnectionText());
  return parts.join(" · ");
});

function conversationActions(conversationId: string) {
  const conversation = workspaceSelectors.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  return conversation ? mobileConversationRowActions(conversation) : undefined;
}

function launchMenu(launchId: string): ContextMenuItem[] {
  return [
    {
      label: "Show output",
      icon: Terminal,
      onSelect: () => openMobileLaunchOutput(launchId),
    },
    {
      label: "Restart",
      icon: RotateCcw,
      onSelect: () => void restartSelectedLaunch(launchId),
    },
    {
      label: "Stop",
      icon: Square,
      destructive: true,
      onSelect: () => void cancelSelectedLaunch(launchId),
    },
  ];
}
</script>

<MobileNewChatFab>
  <MobileScreen
    title="Activity"
    {subtitle}
    onSubtitleSelect={() => (mobileStatusSheet.open = true)}
    subtitleLabel="Daemon status and usage"
  >
    {#snippet actions()}
      <MobileRootActions />
    {/snippet}

    <MobileStatusStrip />

    {#if model.conversations.length}
      <MobileSection
        title="Conversations"
        meta={`${model.conversations.length}`}
      >
        {#each model.conversations as row (row.conversationId)}
          {@const actions = conversationActions(row.conversationId)}
          <MobileListRow
            title={row.title}
            detail={activitySupportingLine(row)}
            meta={relativeTimeLabel(row.at)}
            tone={row.tone}
            pulse={row.pulse}
            chevron={false}
            menuItems={actions?.menuItems}
            swipeLeading={actions?.swipeLeading}
            swipeTrailing={actions?.swipeTrailing}
            onclick={() => void openMobileConversation(row.conversationId)}
          />
        {/each}
      </MobileSection>
    {/if}

    {#if model.launches.length}
      <MobileSection title="Launches" meta={`${model.launches.length}`}>
        {#each model.launches as row (row.launchId)}
          <MobileListRow
            title={row.title}
            detail={activitySupportingLine(row)}
            meta={relativeTimeLabel(row.at)}
            tone={row.tone}
            pulse={row.pulse}
            menuItems={launchMenu(row.launchId)}
            onclick={() => openMobileLaunchOutput(row.launchId)}
          />
        {/each}
      </MobileSection>
    {/if}

    {#if !model.conversations.length && !model.launches.length}
      <Empty.Root class="px-6 py-10">
        <Empty.Header>
          <Empty.Media class="text-muted-foreground">
            <Activity size={28} strokeWidth={1.6} />
          </Empty.Media>
          <Empty.Title class="text-ui">Nothing running</Empty.Title>
          <Empty.Description class="text-ui">
            Running agents and background launches from every project show up
            here.
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
</MobileNewChatFab>
