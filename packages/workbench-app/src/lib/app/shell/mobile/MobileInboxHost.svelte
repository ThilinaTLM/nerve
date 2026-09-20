<script lang="ts">
import {
  MobileInboxView,
  MobileScreen,
  type MobileInboxItem,
} from "$lib/presentation/shell";
import { openConversation } from "$lib/features/conversations";
import { workspaceSelectors } from "$lib/application/workspace";

import MobileStatusStrip from "./MobileStatusStrip.svelte";
import { mobileInboxModel } from "./mobile-inbox-model.svelte";
import { mobileConversationMenu } from "./mobile-conversation-menu.svelte";

/**
 * Triage home: approvals, questions, plan reviews and agent errors first, then
 * everything still running, across every project.
 */
const model = $derived(mobileInboxModel());
const subtitle = $derived.by(() => {
  const parts: string[] = [];
  if (model.needsYou.length) parts.push(`${model.needsYou.length} waiting`);
  if (model.running.length) parts.push(`${model.running.length} running`);
  return parts.length ? parts.join(" · ") : "All caught up";
});

function open(item: MobileInboxItem) {
  void openConversation(item.conversationId);
}

function menu(item: MobileInboxItem) {
  const conversation = workspaceSelectors.conversations.find(
    (candidate) => candidate.id === item.conversationId,
  );
  return conversation ? mobileConversationMenu(conversation) : [];
}
</script>

<MobileScreen title="Inbox" {subtitle}>
  <MobileInboxView {model} onOpen={open} menuItems={menu}>
    {#snippet summary()}
      <MobileStatusStrip />
    {/snippet}
  </MobileInboxView>
</MobileScreen>
