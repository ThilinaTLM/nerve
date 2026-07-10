import type { ContextMenuItem } from "../ui/context-menu-list/index.js";
import type { StatusTone } from "../ui/status-dot/index.js";

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
};

export type ConversationNavigatorGroup = {
  id: string;
  title: string;
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
        [group.title, item.title, item.subtitle, item.searchText]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalized)),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
