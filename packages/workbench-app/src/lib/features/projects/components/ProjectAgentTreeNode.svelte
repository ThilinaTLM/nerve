<script lang="ts">
  import { type ContextMenuItem } from "@nervekit/workbench-ui/components/ui/context-menu-list";
  import { NavigatorItem } from "@nervekit/workbench-ui/components/navigator";
  import type { ConversationActivityState } from "$lib/features/conversations/state/conversation-activity";
  import { conversationActivityForRecord } from "$lib/features/conversations/state/conversation-activity";
  import type { ConversationRow } from "$lib/core/utils/project-tree";
  import { shortAgentModel } from "$lib/core/utils/project-tree";
  import { dateTimeLabel } from "$lib/core/utils/time";

  type Props = {
    row: ConversationRow;
    isOpen?: boolean;
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
</script>

<NavigatorItem
  title={row.conversation.title}
  active={isActive}
  {isOpen}
  statusTone={dotActivity.tone}
  statusPulse={dotActivity.pulse}
  statusLabel={dotActivity.label}
  {menuItems}
  tooltipClass="conversation-tooltip"
  onSelect={() => onOpenConversation?.(row.conversation.id)}
>
  {#snippet tooltip()}
    <span class="tt-title">{row.conversation.title}</span>
    <span class="tt-row"><span class="tt-key">status</span>{status}</span>
    <span class="tt-row"><span class="tt-key">mode</span>{mode} · {permission}</span>
    <span class="tt-row"><span class="tt-key">model</span>{shortAgentModel(row.agent)}</span>
    <span class="tt-row"><span class="tt-key">updated</span>{dateTimeLabel(row.conversation.updatedAt)}</span>
    <span class="tt-id">{row.conversation.id}</span>
  {/snippet}
</NavigatorItem>
