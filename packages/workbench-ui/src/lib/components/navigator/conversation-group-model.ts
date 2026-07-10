import type { Component } from "svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";

export type ConversationNavigatorItem = {
  id: string;
  title: string;
  subtitle?: string;
  searchText?: string;
  active?: boolean;
  open?: boolean;
  statusTone?: StatusTone;
  statusPulse?: boolean;
  statusLabel?: string;
  menuItems?: ContextMenuItem[];
  metadata?: Record<string, string | undefined>;
};

export type ConversationNavigatorGroup = {
  id: string;
  title: string;
  searchText?: string;
  icon?: Component;
  meta?: string;
  open?: boolean;
  selected?: boolean;
  emptyLabel?: string;
  items: ConversationNavigatorItem[];
};

export function filterConversationGroups(
  groups: readonly ConversationNavigatorGroup[],
  query: string,
): ConversationNavigatorGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized)
    return groups.map((group) => ({ ...group, items: [...group.items] }));
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [
          group.title,
          group.searchText,
          item.title,
          item.subtitle,
          item.searchText,
        ]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalized)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
