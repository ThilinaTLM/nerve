<script lang="ts">
import {
  MobileInboxView,
  MobileScreen,
  type MobileInboxItem,
} from "$lib/presentation/shell";
import { workspaceSelectors } from "$lib/application/workspace";
import MobileNewChatFab from "./MobileNewChatFab.svelte";
import MobileRootActions from "./MobileRootActions.svelte";
import MobileStatusStrip from "./MobileStatusStrip.svelte";
import { mobileInboxModel } from "./mobile-inbox-model.svelte";
import { mobileConversationRowActions } from "./mobile-conversation-swipe.svelte";
import { openMobileConversation } from "./mobile-route-activation.svelte";
import {
  mobileConnectionText,
  mobileStatusSheet,
} from "./mobile-status.svelte";

/**
 * Triage home: approvals, questions, plan reviews and agent errors first, then
 * everything still running, then recent conversations — across every project.
 * Rows swipe to mark done, pin or delete; long-press opens the full action
 * sheet. The header subtitle carries the daemon status (tap for details).
 */
const model = $derived(mobileInboxModel());
const subtitle = $derived.by(() => {
  const parts: string[] = [];
  if (model.needsYou.length) parts.push(`${model.needsYou.length} waiting`);
  if (model.running.length) parts.push(`${model.running.length} running`);
  if (model.awaitingAsync.length)
    parts.push(`${model.awaitingAsync.length} in background`);
  if (!parts.length) parts.push("All caught up");
  parts.push(mobileConnectionText());
  return parts.join(" · ");
});

function open(item: MobileInboxItem) {
  void openMobileConversation(item.conversationId);
}

function rowActions(item: MobileInboxItem) {
  const conversation = workspaceSelectors.conversations.find(
    (candidate) => candidate.id === item.conversationId,
  );
  return conversation
    ? mobileConversationRowActions(conversation)
    : { menuItems: [] };
}
</script>

<MobileNewChatFab>
  <MobileScreen
    title="Inbox"
    {subtitle}
    onSubtitleSelect={() => (mobileStatusSheet.open = true)}
    subtitleLabel="Daemon status and usage"
  >
    {#snippet actions()}
      <MobileRootActions />
    {/snippet}
    <MobileInboxView {model} onOpen={open} {rowActions}>
      {#snippet summary()}
        <MobileStatusStrip />
      {/snippet}
    </MobileInboxView>
  </MobileScreen>
</MobileNewChatFab>
