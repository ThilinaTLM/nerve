<script lang="ts">
import { type ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { PanelRow, PanelRowCard } from "$lib/presentation/panel";
import type { ConversationActivityState } from "$lib/kernel/conversations/activity";
import { conversationActivityForRecord } from "$lib/kernel/conversations/activity";
import type { ConversationRow } from "$lib/kernel/utils/project-tree";
import { shortAgentModel } from "$lib/kernel/utils/project-tree";
import { permissionRuleSetDisplayName } from "$lib/kernel/permissions/permission-rule-set-options";
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

const status = $derived(row.agent?.status ?? "idle");
const dotActivity = $derived(
  activity ??
    conversationActivityForRecord({
      conversationId: row.conversation.id,
      agent: row.agent,
      mode: row.agent?.mode ?? row.conversation.mode,
      completedAt: row.conversation.completedAt,
      runtimeStatusClearedAt: row.conversation.runtimeStatusClearedAt,
    }),
);
const mode = $derived(row.agent?.mode ?? row.conversation.mode);
const permission = $derived(
  row.agent?.permissionRuleSetId ??
    row.agent?.permissionLevel ??
    row.conversation.permissionLevel,
);
const tooltip = $derived(
  [
    row.conversation.title,
    `status: ${dotActivity.label ?? status}`,
    `mode: ${mode} · rule set: ${permissionRuleSetDisplayName(permission)}`,
    `model: ${shortAgentModel(row.agent)}`,
    row.conversation.id,
  ].join("\n"),
);
</script>

<PanelRowCard
  itemKey={row.conversation.id}
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
