<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Pin from "@lucide/svelte/icons/pin";
import PinOff from "@lucide/svelte/icons/pin-off";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Users from "@lucide/svelte/icons/users";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { relativeTimeLabel } from "@nervekit/ui-kit/display/time";
import { type ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { PanelRow, PanelRowCard } from "$lib/presentation/panels";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import { idleConversationActivity } from "$lib/presentation/conversations/conversation-activity";
import type { ConversationRow } from "$lib/domain/projects/project-tree";
import { shortAgentModel } from "$lib/domain/projects/project-tree";
import { permissionRuleSetDisplayName } from "$lib/domain/permissions/rule-set-options";
import ConversationActivityIndicator from "$lib/presentation/conversations/ConversationActivityIndicator.svelte";
import {
  conversationRowDetail,
  conversationRowGlyph,
} from "$lib/presentation/conversations/conversation-row-state";
import type { UpdateConversationStateRequest } from "$lib/domain/projects/sidebar-view-models";

type Props = {
  row: ConversationRow;
  /** Conversation has an open center tab; fills dot-based indicators. */
  isOpen?: boolean;
  /** Conversation currently shown in the main pane. */
  isActive?: boolean;
  activity?: ConversationActivity;
  menuItems: ContextMenuItem[];
  onOpenConversation?: (conversationId: string) => void;
  /** Enables the hover Pin and Mark done actions; same handler as the menu. */
  onUpdateConversationState?: (
    conversationId: string,
    request: UpdateConversationStateRequest,
  ) => void;
};

let {
  row,
  isOpen = false,
  isActive = false,
  activity,
  menuItems,
  onOpenConversation,
  onUpdateConversationState,
}: Props = $props();

const dotActivity = $derived(activity ?? idleConversationActivity);
const profile = $derived(
  row.agent?.agentProfile ?? row.conversation.agentProfile,
);
const permission = $derived(
  row.agent?.permissionRuleSetId ?? row.conversation.permissionRuleSetId,
);
const glyph = $derived(conversationRowGlyph(dotActivity, isOpen));
const detail = $derived(conversationRowDetail(dotActivity));
const completed = $derived(Boolean(row.conversation.completedAt));
const pinned = $derived(row.conversation.pinned);
const childCount = $derived(row.conversation.childCount);
const age = $derived(
  relativeTimeLabel(
    row.conversation.lastUserMessageAt ?? row.conversation.createdAt,
  ),
);
const tooltip = $derived(
  [
    row.conversation.title,
    `status: ${dotActivity.label ?? "idle"}`,
    `profile: ${profile ?? "unknown"} · rule set: ${permission ? permissionRuleSetDisplayName(permission) : "unknown"}`,
    `model: ${shortAgentModel(row.agent)}`,
    row.conversation.id,
  ].join("\n"),
);
</script>

{#snippet rowActions()}
  <IconAction
    icon={pinned ? PinOff : Pin}
    label={pinned ? "Unpin" : "Pin"}
    onclick={(event: MouseEvent) => {
      event.stopPropagation();
      onUpdateConversationState?.(row.conversation.id, {
        pinned: !pinned,
      });
    }}
  />
  <IconAction
    icon={completed ? RotateCcw : CircleCheck}
    label={completed ? "Reopen" : "Mark done"}
    onclick={(event: MouseEvent) => {
      event.stopPropagation();
      onUpdateConversationState?.(row.conversation.id, {
        completed: !completed,
      });
    }}
  />
{/snippet}

<PanelRowCard
  selected={isActive}
  {menuItems}
  onclick={() => onOpenConversation?.(row.conversation.id)}
>
  <PanelRow
    label={row.conversation.title}
    labelLines={2}
    dataId={row.conversation.id}
    title={tooltip}
    flush
    hoverable={false}
    class="pl-0"
    active={isActive}
    tone={completed ? "neutral" : "accent"}
    detail={detail?.text}
    detailTone={detail?.tone}
    actions={onUpdateConversationState ? rowActions : undefined}
  >
    {#snippet leading()}
      <span class="flex h-4 w-3 items-center justify-center">
        {#if glyph === "activity"}
          <ConversationActivityIndicator
            activity={dotActivity}
            {isOpen}
            size="sm"
          />
        {:else if glyph === "open-dot"}
          <ConversationActivityIndicator
            activity={dotActivity}
            isOpen
            size="xs"
          />
        {/if}
      </span>
    {/snippet}
    {#snippet trailing()}
      {#if profile === "planning"}
        <ClipboardList class="size-3" aria-label="Planning profile" />
      {/if}
      {#if childCount > 0}
        <span
          class="flex items-center gap-0.5"
          aria-label={`${childCount} sub-agents`}
        >
          <Users class="size-3" aria-hidden="true" />{childCount}
        </span>
      {/if}
      {#if age}<span>{age}</span>{/if}
    {/snippet}
  </PanelRow>
</PanelRowCard>
