<script lang="ts">
import { type ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { PanelRow, PanelRowCard } from "$lib/presentation/panels";
import type { ConversationActivityState } from "$lib/domain/projects/sidebar-view-models";
import { idleConversationActivity } from "$lib/domain/projects/sidebar-view-models";
import type { ConversationRow } from "$lib/domain/projects/project-tree";
import { shortAgentModel } from "$lib/domain/projects/project-tree";
import { permissionRuleSetDisplayName } from "$lib/domain/permissions/rule-set-options";
import ConversationStatusIndicator from "./ConversationStatusIndicator.svelte";

type Props = {
  row: ConversationRow;
  /** Conversation has an open center tab; fills dot-based indicators. */
  isOpen?: boolean;
  /** Conversation currently shown in the main pane. */
  isActive?: boolean;
  activity?: ConversationActivityState;
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
  row.agent?.permissionRuleSetId ??
    row.agent?.permissionLevel ??
    row.conversation.permissionLevel,
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
      <ConversationStatusIndicator activity={dotActivity} {isOpen} />
    {/snippet}
  </PanelRow>
</PanelRowCard>
