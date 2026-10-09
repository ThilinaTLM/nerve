<script lang="ts">
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import { PanelRow, PanelRowCard } from "$lib/presentation/panels";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import type { ConversationRow } from "$lib/domain/projects/project-tree";
import {
  summaryActivity,
  type ConversationActivity,
} from "$lib/application/workspace/conversation-activity";
import ConversationStatusIndicator from "./ConversationStatusIndicator.svelte";
let {
  row,
  isOpen = false,
  isActive = false,
  activity,
  menuItems,
  onOpenConversation,
  expanded = false,
  onToggleChildren,
  child = false,
}: {
  row: ConversationRow;
  isOpen?: boolean;
  isActive?: boolean;
  activity?: ConversationActivity;
  menuItems: ContextMenuItem[];
  onOpenConversation?: (id: string) => void;
  expanded?: boolean;
  onToggleChildren?: () => void;
  child?: boolean;
} = $props();
const dotActivity = $derived(activity ?? summaryActivity(row.conversation));
</script>
<div class={child ? "pl-4" : ""}>
  <PanelRowCard
    selected={isActive}
    {menuItems}
    onclick={() => onOpenConversation?.(row.conversation.id)}
  >
    <PanelRow
      label={row.conversation.title}
      labelLines={2}
      title={`${row.conversation.title}\nstatus: ${dotActivity.label ?? "idle"}`}
      class="px-2"
      active={isActive}
    >
      {#snippet leading()}
        {#if !child && row.conversation.childCount > 0}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? "Collapse children" : "Expand children"}
            onclick={(event) => {
              event.stopPropagation();
              onToggleChildren?.();
            }}
          >
            {#if expanded}<ChevronDown />{:else}<ChevronRight />{/if}
          </Button>
        {/if}
        <ConversationStatusIndicator activity={dotActivity} {isOpen} />
      {/snippet}
    </PanelRow>
  </PanelRowCard>
</div>
