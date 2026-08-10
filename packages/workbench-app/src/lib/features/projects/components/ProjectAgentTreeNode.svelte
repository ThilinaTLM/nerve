<script lang="ts">
import { type ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { PanelRow } from "$lib/presentation/panel";
import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";
import { conversationActivityForRecord } from "$lib/features/conversations/state/conversation-activity";
import type { ConversationRow } from "$lib/core/utils/project-tree";
import { shortAgentModel } from "$lib/core/utils/project-tree";
import { dateTimeLabel } from "@nervekit/ui-kit/core/utils/time";

type Props = {
  row: ConversationRow;
  /** Conversation has an open tab; drives the solid status dot. */
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
    }),
);
const mode = $derived(row.agent?.mode ?? row.conversation.mode);
const permission = $derived(
  row.agent?.permissionLevel ?? row.conversation.permissionLevel,
);
const tooltip = $derived(
  [
    row.conversation.title,
    `status: ${status}`,
    `mode: ${mode} · ${permission}`,
    `model: ${shortAgentModel(row.agent)}`,
    `updated: ${dateTimeLabel(row.conversation.updatedAt)}`,
    row.conversation.id,
  ].join("\n"),
);
</script>

<PanelRow
  label={row.conversation.title}
  title={tooltip}
  status={dotActivity.tone}
  statusVariant={isOpen ? "solid" : "outline"}
  pulse={dotActivity.pulse}
  class="px-2"
  active={isActive}
  {menuItems}
  onclick={() => onOpenConversation?.(row.conversation.id)}
/>
