<script lang="ts">
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import {
  MobileInboxView,
  MobileScreen,
  type MobileInboxItem,
} from "$lib/presentation/shell";
import { workspaceSelectors } from "$lib/application/workspace";
import MobileRootActions from "./MobileRootActions.svelte";
import MobileStatusStrip from "./MobileStatusStrip.svelte";
import { mobileInboxModel } from "./mobile-inbox-model.svelte";
import { mobileConversationMenu } from "./mobile-conversation-menu.svelte";
import { openMobileConversation } from "./mobile-route-activation.svelte";

/**
 * Triage home: approvals, questions, plan reviews and agent errors first, then
 * everything still running, then recent conversations — across every project.
 * Approvals resolve straight from the row menu; questions and plans need the
 * full transcript card, so they open the conversation.
 */
const model = $derived(mobileInboxModel());
const subtitle = $derived.by(() => {
  const parts: string[] = [];
  if (model.needsYou.length) parts.push(`${model.needsYou.length} waiting`);
  if (model.running.length) parts.push(`${model.running.length} running`);
  if (model.awaitingAsync.length)
    parts.push(`${model.awaitingAsync.length} in background`);
  return parts.length ? parts.join(" · ") : "All caught up";
});

function open(item: MobileInboxItem) {
  void openMobileConversation(item.conversationId);
}

function menu(item: MobileInboxItem): ContextMenuItem[] {
  const conversation = workspaceSelectors.conversations.find(
    (candidate) => candidate.id === item.conversationId,
  );
  const conversationItems = conversation
    ? mobileConversationMenu(conversation)
    : [];
  return conversationItems;
}
</script>

<MobileScreen title="Inbox" {subtitle}>
  {#snippet actions()}
    <MobileRootActions />
  {/snippet}
  <MobileInboxView {model} onOpen={open} menuItems={menu}>
    {#snippet summary()}
      <MobileStatusStrip />
    {/snippet}
  </MobileInboxView>
</MobileScreen>
