<script lang="ts">
import { type ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { PanelRow, PanelRowCard } from "$lib/presentation/panels";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import { idleConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import type { ConversationRow } from "$lib/domain/projects/project-tree";
import { shortAgentModel } from "$lib/domain/projects/project-tree";
import { permissionRuleSetDisplayName } from "$lib/domain/permissions/rule-set-options";
import ConversationActivityIndicator from "$lib/presentation/conversations/ConversationActivityIndicator.svelte";

type Props = {
  row: ConversationRow;
  /** Conversation has an open center tab; fills dot-based indicators. */
  isOpen?: boolean;
  /** Conversation currently shown in the main pane. */
  isActive?: boolean;
  activity?: ConversationActivity;
  menuItems: ContextMenuItem[];
  onOpenConversation?: (conversationId: string) => void;
};

let {
  row,
  isOpen = false,
  isActive = false,
  activity,
  menuItems,
  onOpenConversation,
}: Props = $props();

const dotActivity = $derived(activity ?? idleConversationActivity);
const mode = $derived(row.agent?.mode ?? row.conversation.mode);
const permission = $derived(
  row.agent?.permissionRuleSetId ?? row.conversation.permissionRuleSetId,
);
const tooltip = $derived(
  [
    row.conversation.title,
    `status: ${dotActivity.label ?? "idle"}`,
    `mode: ${mode} · rule set: ${permissionRuleSetDisplayName(permission)}`,
    `model: ${shortAgentModel(row.agent)}`,
    row.conversation.id,
  ].join("\n"),
);
</script>

<PanelRowCard
  selected={isActive}
  {menuItems}
  onclick={() => onOpenConversation?.(row.conversation.id)}
>
  <PanelRow
    label={row.conversation.title}
    labelLines={2}
    title={tooltip}
    class="px-2"
    active={isActive}
  >
    {#snippet leading()}
      <ConversationActivityIndicator
        activity={dotActivity}
        {isOpen}
        size="md"
      />
    {/snippet}
  </PanelRow>
</PanelRowCard>
